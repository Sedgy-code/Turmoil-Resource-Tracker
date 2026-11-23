import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { DEFAULT_WAR_RATES } from "../src/lib/war";
import { ascendCheck, buildOrder, guideTargets, orderDay, orderWeek, resourcesOnDay, scoringDays } from "../src/lib/spending-order";
import type { Member, ResourceEntry } from "../src/lib/types";
import { EMPTY_RESOURCES, type ResourceValues } from "../src/lib/resources";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import {
  getSpendingOrder, plainName, postSpendingNow, spendingPost, spendingPostPreview,
  spendingPostTitle, syncSpendingPosts, updateSpendingPostsNow, updateSpendingSettings,
} from "../src/lib/server/spending-order";
import { spendSettingsSchema } from "../src/lib/server/validation";

// The war of Monday 23 November 2026: Day 1 is Tuesday 24th, Day 3 Thursday 26th, Day 6 Sunday 29th.
const WEEK = "2026-11-23";
const DAY_1 = new Date("2026-11-24T05:00:00Z");
const DAY_2 = new Date("2026-11-25T05:00:00Z");
const DAY_3 = new Date("2026-11-26T00:10:00Z");
const DAY_4 = new Date("2026-11-27T00:06:00Z");
const DAY_6 = new Date("2026-11-29T05:00:00Z");

function entry(memberId: string, resources: Partial<ResourceValues>, extra: { fiveSkills?: number; mount?: number; skillLevel?: number; eggLevel?: number; mountLevel?: number; pet?: number; mountChance?: number } = {}): ResourceEntry {
  return {
    id: `bank:${memberId}`, memberId, week: WEEK, notes: "", updatedAt: DAY_1.toISOString(), updatedBy: { id: memberId, username: "" },
    resources: { ...EMPTY_RESOURCES, ...resources },
    summoningCosts: { fiveSkills: extra.fiveSkills ?? 200, mount: extra.mount ?? 50 },
    planningDetails: {
      skillLevel: extra.skillLevel ?? 100, mountLevel: extra.mountLevel ?? 100, eggLevel: extra.eggLevel ?? 100,
      newMountMerges: 0, eggMerges: 0, eggSummonMerges: 0,
      extraMountChancePercent: extra.mountChance ?? 0, extraPetSummonPercent: extra.pet ?? 0, calculationVersion: 2,
    },
  };
}
const person = (id: string, username: string, holidayUntil: string | null = null): Member => ({
  id, discordId: `d-${id}`, username, avatarUrl: null, role: "MEMBER", active: true, lastUpdatedAt: null, joinedAt: DAY_1.toISOString(), holidayUntil,
});

test("ascend checks use the official guide's numbers, with each member's own discount and extra chance", () => {
  // Skills: Legendary needs 49,600 tickets at base cost, 37,200 with the 25% discount (150 for 5 skills).
  assert.deepEqual(guideTargets("skills", entry("a", {}, { fiveSkills: 200 })).map((item) => item.need), [49_600, 142_000, 269_600]);
  assert.deepEqual(guideTargets("skills", entry("a", {}, { fiveSkills: 150 })).map((item) => item.need), [37_200, 106_500, 202_200]);
  // Pets: Legendary 48,600 eggshells, 32,400 with +50% extra; Epic 7,100 → 4,733.
  assert.deepEqual(guideTargets("pets", entry("a", {}, { pet: 50 })).map((item) => item.need), [4_733, 32_400, 60_000, 98_333]);
  // Mounts: Epic 30,000 clock winders, 15,000 with 25% discount and 50% extra drop.
  assert.deepEqual(guideTargets("mounts", entry("a", {}, { mount: 37.5, mountChance: 50 })).map((item) => item.need), [15_000, 23_000, 31_500, 39_500]);

  assert.deepEqual(ascendCheck("skills", entry("a", { skillTickets: 120_000 }, { fiveSkills: 150 })), { state: "ready", have: 120_000, need: 37_200, reaches: "Ultimate" });
  assert.deepEqual(ascendCheck("skills", entry("a", { skillTickets: 30_000 }, { fiveSkills: 150 })), { state: "short", have: 30_000, need: 37_200, missing: 7_200, reaches: null });
  // Enough for Epic pets but not the recommended Legendary.
  assert.deepEqual(ascendCheck("pets", entry("a", { eggshellsTotal: 20_000 }, { pet: 50 })), { state: "short", have: 20_000, need: 32_400, missing: 12_400, reaches: "Epic" });
  // Below summon level 100 a pillar can't be ascended yet; a level never saved (0) is judged by resources.
  assert.deepEqual(ascendCheck("mounts", entry("a", { mountKeys: 90_000 }, { mountLevel: 82 })), { state: "level", level: 82 });
  assert.equal(ascendCheck("mounts", entry("a", { mountKeys: 90_000 }, { mountLevel: 0 })).state, "ready");
  assert.deepEqual(ascendCheck("skills", undefined), { state: "none" });
});

test("each line is for today's clan day, or the next one where it scores", () => {
  assert.deepEqual(scoringDays("skills"), [1, 3]);
  assert.deepEqual(scoringDays("pets"), [3, 5]);
  assert.deepEqual(scoringDays("mounts"), [2, 4]);
  assert.deepEqual(resourcesOnDay(3), ["skills", "pets"]);
  assert.deepEqual(resourcesOnDay(6), []);
  assert.deepEqual(orderDay("skills", [1, 3], 1, false), { day: 1, today: true });
  assert.deepEqual(orderDay("skills", [1, 3], 2, false), { day: 3, today: false });
  assert.deepEqual(orderDay("pets", [1, 3], 2, false), { day: 3, today: false });
  assert.deepEqual(orderDay("mounts", [1, 3], 2, false), { day: null, today: false });
  // Days 6 and 7: the next war's first clan day.
  assert.deepEqual(orderDay("skills", [3, 4], 7, true), { day: 3, today: false });
  assert.deepEqual(orderWeek(DAY_3), { week: WEEK, warDay: 3, nextWar: false });
  assert.deepEqual(orderWeek(DAY_6), { week: "2026-11-30", warDay: 6, nextWar: true });
});

test("snipers go first, then the biggest stockpile; members away are skipped", () => {
  const members = [person("a", "Ana"), person("b", "Bo"), person("c", "Cy"), person("d", "Di", "2026-11-27"), person("e", "Ed"), person("f", "Fay")];
  const entries = [
    entry("a", { skillTickets: 50_000 }),
    entry("b", { skillTickets: 90_000 }),
    entry("c", { skillTickets: 10_000 }),
    entry("d", { skillTickets: 99_000 }),
    entry("e", { skillTickets: 70_000 }),
    entry("f", {}), // nothing saved for skills: not in the order
  ];
  const line = buildOrder({
    resource: "skills", members, entries, rates: DEFAULT_WAR_RATES, ascending: new Map([["c", ["skills" as const]]]),
    snipers: new Set(["c"]), date: "2026-11-26", day: 3, today: true,
  });
  assert.deepEqual(line.rows.map((row) => [row.member.username, row.state, row.place]), [
    ["Cy", "line", 1], ["Bo", "line", 2], ["Ed", "line", 3], ["Ana", "line", 4], ["Di", "away", null],
  ]);
  assert.deepEqual([line.day, line.today], [3, true]);
  assert.equal(line.rows[0].sniper, true);
  assert.equal(line.rows[0].ascending, true);
  // 90,000 tickets at 200 for 5 = 2,250 skill summons × 225 points.
  assert.equal(line.rows[1].points, 2_250 * 225);
  // Back from holiday by Day 5, and no snipe that day: Di is back in the order, biggest first.
  const later = buildOrder({ resource: "skills", members, entries, rates: DEFAULT_WAR_RATES, ascending: new Map(), snipers: new Set(), date: "2026-11-28", day: 5, today: false });
  assert.deepEqual(later.rows.map((row) => [row.member.username, row.place]), [["Di", 1], ["Bo", 2], ["Ed", 3], ["Ana", 4], ["Cy", 5]]);
});

test("the post is an embed like the app's table, in English, never pinging anyone", () => {
  assert.equal(spendingPostTitle(3, new Date("2026-11-26T00:00:00Z")), "Day 3 – Skills and Pets · Thu 26 Nov");
  assert.equal(spendingPostTitle(2, new Date("2026-11-25T00:00:00Z")), "Day 2 – Mounts · Wed 25 Nov");
  assert.equal(plainName("*Star*_x @everyone"), "\\*Star\\*\\_x @\u200beveryone");
  const members = [person("a", "Ana"), person("b", "Bo"), person("c", "Cy", "2026-11-30"), person("d", "Di"), person("e", "Ed")];
  const line = buildOrder({
    resource: "skills", members, rates: DEFAULT_WAR_RATES, ascending: new Map(), snipers: new Set(["a"]), date: "2026-11-26", day: 3, today: true,
    entries: [
      entry("a", { skillTickets: 50_000 }), entry("b", { skillTickets: 90_000 }), entry("c", { skillTickets: 1_000 }),
      entry("d", { skillTickets: 30_000 }), entry("e", { skillTickets: 20_000 }, { skillLevel: 82 }),
    ],
  });
  const { content, embed } = spendingPost(3, [line], "https://tracker.example");
  assert.equal(content, "Find your place below, and ask questions here.");
  assert.equal(embed.title, "📋 Spending order – Day 3 (clan day)");
  assert.equal(embed.url, "https://tracker.example/spending-order");
  assert.equal(embed.author.iconUrl, "https://tracker.example/app-icons/icon-192.png");
  assert.equal(embed.description, "Day 3 is on now. Spend in this order.\nBiggest stockpiles first, counted in war points.");
  // Like the app: place, name, war points and the ascend check. Cy is away, so skipped.
  assert.deepEqual(embed.fields, [{
    name: "🎟️ Skills · 4 in line",
    value: [
      "1. 🎯 Ana · 281.3K pts · ✅ Legendary",
      "2. Bo · 506.3K pts · ✅ Legendary",
      "3. Di · 168.8K pts · ⏳ needs 19.6K",
      "4. Ed · 112.5K pts · 🔒 Lv 82",
    ].join("\n"),
  }]);
  assert.equal(embed.footer, "✅ ready to ascend · ⏳ not enough yet · 🔒 summon level under 100 · 🎯 in the Day 3 snipe");
  assert.deepEqual(embed.button, { label: "Open the Spending Order", url: "https://tracker.example/spending-order" });
  // Up the day before: it says when the day starts, and that the order will update.
  const early = spendingPost(3, [line], "https://tracker.example", new Date("2026-11-26T00:00:00Z")).embed;
  assert.match(early.description, /^Day 3 starts 00:00 UTC Thu 26 Nov\. The order updates when it starts\.\n/);
  const everything = JSON.stringify({ content, embed });
  assert.doesNotMatch(everything, /<@|Your turn|I'm done/);
  assert.doesNotMatch(everything, /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/u);
  // A long order fits Discord's limits: fields of up to 1,024 characters, and the rest counted.
  const many = Array.from({ length: 120 }, (_, index) => person(`m${index}`, `Member number ${index} with a long name`));
  const long = buildOrder({
    resource: "skills", members: many, entries: many.map((member, index) => entry(member.id, { skillTickets: 10_000 + index })),
    rates: DEFAULT_WAR_RATES, ascending: new Map(), snipers: new Set(), date: "2026-11-26", day: 3, today: true,
  });
  const cut = spendingPost(3, [long], "https://tracker.example").embed;
  const size = cut.title.length + cut.description.length + cut.footer.length + cut.author.name.length + cut.fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
  assert.ok(size <= 6000 && cut.fields.length <= 25 && cut.fields.every((field) => field.value.length <= 1024 && field.name.length > 0), `size ${size}`);
  assert.equal(cut.fields[0].name, "🎟️ Skills · 120 in line");
  assert.equal(cut.fields[1].name, "\u200b");
  assert.match(cut.fields[cut.fields.length - 1].value, /\n\+\d+ more on the Clan Hub$/);
});

test("only the post switch can be sent", () => {
  assert.deepEqual(spendSettingsSchema.parse({ postEnabled: true }), { postEnabled: true });
  assert.throws(() => spendSettingsSchema.parse({ turns: { skills: 2 } }));
  assert.throws(() => spendSettingsSchema.parse({ postEnabled: true, turns: { skills: 2 } }));
  assert.throws(() => spendSettingsSchema.parse({}));
});

/* ----- The server, with a real (in-memory) database ----- */

let db: Database;
const previous = { ...process.env };
before(async () => {
  db = await openDatabase({ localPath: "memory://" });
  await initializeSchema(db);
});
after(async () => {
  await db.close();
  process.env = previous;
});

async function addMember(username: string, role: "ADMIN" | "MEMBER" = "MEMBER"): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id, discord_id, username, role) VALUES ($1, $2, $3, $4) RETURNING *", [randomUUID(), `${Math.floor(Math.random() * 1e15)}`, username, role]);
  return memberFromRow(rows[0]);
}
async function saveBank(member: Member, resources: Partial<ResourceValues>) {
  const bank = entry(member.id, resources, { fiveSkills: 150, pet: 50 });
  await db.query(`INSERT INTO member_banks (member_id, resources, summoning_costs, planning_details, notes, updated_at, updated_by)
    VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, '', $5, $1) ON CONFLICT (member_id) DO UPDATE SET resources = EXCLUDED.resources`,
  [member.id, JSON.stringify(bank.resources), JSON.stringify(bank.summoningCosts), JSON.stringify(bank.planningDetails), DAY_1.toISOString()]);
}

test("everyone sees the order; only leaders switch the post; Days 6–7 look at the next war", async () => {
  const leader = await addMember("Lead", "ADMIN");
  const ana = await addMember("Ana");
  const bo = await addMember("Bo");
  const cy = await addMember("Cy");
  await saveBank(ana, { skillTickets: 80_000, eggsPetsTotal: 900, eggshellsTotal: 40_000 });
  await saveBank(bo, { skillTickets: 60_000, eggsPetsTotal: 100 });
  await saveBank(cy, { skillTickets: 40_000, eggshellsTotal: 5_000 });
  await db.query("INSERT INTO clan_war_days (war_week, days) VALUES ($1, '1,3')", [WEEK]);
  // Bo said Yes to Day 3's skills snipe, so Bo goes first in the Skills order that day.
  const snipe = randomUUID();
  await db.query("INSERT INTO snipe_plans (id, title, starts_at, activities, created_by) VALUES ($1, 'Day 3 – Skills', '2026-11-26T23:30:00Z', '[\"skillSummons\"]'::jsonb, $2)", [snipe, leader.id]);
  await db.query("INSERT INTO snipe_responses (snipe_id, member_id, answer) VALUES ($1, $2, 'yes')", [snipe, bo.id]);

  const onDay2 = await getSpendingOrder(ana, db, DAY_2);
  assert.equal(onDay2.post, undefined); // only leaders see the post's state
  const skills = onDay2.orders.find((line) => line.resource === "skills")!;
  assert.deepEqual([skills.day, skills.today], [3, false]);
  assert.deepEqual(skills.rows.map((row) => [row.member.username, row.place]), [["Bo", 1], ["Ana", 2], ["Cy", 3]]);
  assert.equal(onDay2.orders.find((line) => line.resource === "mounts")!.day, null);
  // On Day 1 the Skills order is for today, so the Day 3 snipe doesn't count yet.
  const onDay1 = (await getSpendingOrder(ana, db, DAY_1)).orders.find((line) => line.resource === "skills")!;
  assert.deepEqual([onDay1.day, onDay1.today, onDay1.rows[0].member.username], [1, true, "Ana"]);

  await assert.rejects(updateSpendingSettings(ana, { postEnabled: true }, { db, now: DAY_3 }), (error) => error instanceof ApiError && error.code === "ADMIN_REQUIRED");
  const leaders = await getSpendingOrder(leader, db, DAY_3);
  assert.deepEqual([leaders.post?.enabled, leaders.post?.openDays], [false, []]);
  const off = await updateSpendingSettings(leader, { postEnabled: false }, { db, now: DAY_3 });
  assert.equal(off.post?.enabled, false);
  // Battle day: this war's spending is over, so it's the next war's order.
  const battle = await getSpendingOrder(bo, db, DAY_6);
  assert.deepEqual([battle.nextWar, battle.week, battle.clanDays], [true, "2026-11-30", []]);
});

test("each clan day's post goes up the day before, updates when the day starts, and closes when it ends", async () => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_BOT_TOKEN: "bot-token", DISCORD_SPENDING_CHANNEL_ID: "555" });
  const leader = (await db.query("SELECT * FROM app_members WHERE username = 'Lead'")).map(memberFromRow)[0];
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  let threads = 700;
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method ?? "GET"), body: init.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify(url.endsWith("/threads") ? { id: String(++threads) } : {}), { status: 200 });
  }) as unknown as typeof fetch;
  type Sent = { content?: string; flags?: number; allowed_mentions?: unknown; embeds?: { description: string; url: string; fields: { name: string; value: string }[] }[]; components?: { components: { url: string }[] }[] };
  const sent = (index: number) => (calls[index].body.message ?? calls[index].body) as Sent;
  // The embed as one text: description, then each field's name and list.
  const content = (index: number) => {
    const embed = sent(index).embeds![0];
    return [embed.description, ...embed.fields.map((field) => `${field.name}\n${field.value}`)].join("\n");
  };

  // Switched off: nothing is posted, and leaders can't post by hand.
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: DAY_1 }), { closed: 0, refreshed: null, opened: [], skipped: "switched off" });
  await assert.rejects(postSpendingNow(leader, { db, fetcher, now: DAY_1 }), (error) => error instanceof ApiError && error.code === "SPENDING_POST_OFF");
  const preview = await spendingPostPreview(leader, db, DAY_1);
  assert.deepEqual([preview.day, preview.due, preview.posted, preview.enabled], [1, true, false, false]);
  assert.equal(preview.title, "Day 1 – Skills · Tue 24 Nov");
  assert.match(preview.embed!.description, /Day 1 is on now/);
  assert.equal(calls.length, 0);

  // Switched on during Day 1, whose post never went up: it goes up late, already "on now". Day 2 isn't a clan day.
  await updateSpendingSettings(leader, { postEnabled: true }, { db, now: DAY_1 });
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: DAY_1 }), { closed: 0, refreshed: null, opened: [1] });
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [["POST", "https://discord.com/api/v10/channels/555/threads"]]);
  assert.equal(calls[0].body.name, "Day 1 – Skills · Tue 24 Nov");
  assert.equal(calls[0].body.auto_archive_duration, 4320);
  assert.deepEqual(sent(0).allowed_mentions, { parse: [] });
  assert.equal(sent(0).flags, undefined); // embeds on
  assert.equal(sent(0).content, "Find your place below, and ask questions here.");
  assert.equal(sent(0).components![0].components[0].url, "https://tracker.example/spending-order");
  assert.match(content(0), /Day 1 is on now\.[\s\S]*🎟️ Skills · 3 in line\n1\. Ana · [^\n]+\n2\. Bo · [^\n]+\n3\. Cy · /);

  // Day 2: Day 1's post closes, and Day 3's goes up the day before, with Bo (in the Day 3 snipe) first.
  calls.length = 0;
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: DAY_2 }), { closed: 1, refreshed: null, opened: [3] });
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ["PATCH", "https://discord.com/api/v10/channels/701"],
    ["POST", "https://discord.com/api/v10/channels/555/threads"],
  ]);
  assert.deepEqual({ ...calls[0].body }, { archived: true, locked: true });
  assert.equal(calls[1].body.name, "Day 3 – Skills and Pets · Thu 26 Nov");
  assert.match(content(1), /Day 3 starts 00:00 UTC Thu 26 Nov\. The order updates when it starts\./);
  assert.match(content(1), /🎟️ Skills · 3 in line\n1\. 🎯 Bo · [^\n]+\n2\. Ana · [^\n]+\n3\. Cy · /);
  assert.match(content(1), /🥚 Pets · \d in line\n1\. Ana · /);
  assert.equal(sent(1).embeds![0].url, "https://tracker.example/spending-order");
  // The midday run (or a second run) opens nothing new, and there's nothing left to post by hand.
  calls.length = 0;
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: new Date("2026-11-25T12:05:00Z") }), { closed: 0, refreshed: null, opened: [] });
  assert.equal(calls.length, 0);
  await assert.rejects(postSpendingNow(leader, { db, fetcher, now: DAY_2 }), (error) => error instanceof ApiError && error.code === "SPENDING_POST_EXISTS");
  const upNow = await spendingPostPreview(leader, db, DAY_2);
  assert.deepEqual([upNow.day, upNow.due, upNow.posted], [3, true, true]);
  assert.deepEqual((await getSpendingOrder(leader, db, DAY_2)).post?.openDays, [3]);
  // A leader can update the post with the latest order (only leaders); the start-of-day update still comes.
  const bo = (await db.query("SELECT * FROM app_members WHERE username = 'Bo'")).map(memberFromRow)[0];
  await assert.rejects(updateSpendingPostsNow(bo, { db, fetcher, now: DAY_2 }), (error) => error instanceof ApiError && error.code === "ADMIN_REQUIRED");
  const updated = await updateSpendingPostsNow(leader, { db, fetcher, now: DAY_2 });
  assert.deepEqual([updated.day, updated.posted], [3, true]);
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [["PATCH", "https://discord.com/api/v10/channels/702/messages/702"]]);
  assert.equal(sent(0).flags, 0); // also switches embeds back on for posts made before the embed
  assert.match(content(0), /Day 3 starts 00:00 UTC Thu 26 Nov/);

  // Day 3 starts: the post gets the order as it stands now, once.
  calls.length = 0;
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: DAY_3 }), { closed: 0, refreshed: 3, opened: [] });
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [["PATCH", "https://discord.com/api/v10/channels/702/messages/702"]]);
  assert.match(content(0), /Day 3 is on now\. Spend in this order\./);
  assert.deepEqual(sent(0).allowed_mentions, { parse: [] });
  calls.length = 0;
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: new Date("2026-11-26T12:05:00Z") }), { closed: 0, refreshed: null, opened: [] });
  assert.equal(calls.length, 0);

  // Day 4 starts: Day 3's post is archived and locked; Day 4 isn't a clan day, so nothing opens.
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: DAY_4 }), { closed: 1, refreshed: null, opened: [] });
  assert.deepEqual(calls.map((call) => [call.method, call.url, call.body]), [["PATCH", "https://discord.com/api/v10/channels/702", { archived: true, locked: true }]]);
  assert.deepEqual((await getSpendingOrder(leader, db, DAY_4)).post?.openDays, []);
  await assert.rejects(updateSpendingPostsNow(leader, { db, fetcher, now: DAY_4 }), (error) => error instanceof ApiError && error.code === "NO_SPENDING_POST");

  // Day 7 (Monday): the next war's Day 1 post goes up the day before. If Discord says no, nothing is
  // kept, so the next run (or a leader's Post now) tries again.
  const monday = new Date("2026-11-30T05:00:00Z");
  await db.query("INSERT INTO clan_war_days (war_week, days) VALUES ('2026-11-30', '1,2')");
  const refuse = (async () => new Response(JSON.stringify({ message: "Missing Permissions", code: 50013 }), { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(syncSpendingPosts({ db, fetcher: refuse, now: monday }), (error) => error instanceof ApiError && error.code === "SPENDING_POST_FAILED");
  assert.equal((await db.query("SELECT 1 FROM spending_posts WHERE war_week = '2026-11-30'")).length, 0);
  calls.length = 0;
  const posted = await postSpendingNow(leader, { db, fetcher, now: monday });
  assert.deepEqual([posted.day, posted.due, posted.posted], [1, true, true]);
  assert.equal(calls[0].body.name, "Day 1 – Skills · Tue 1 Dec");
  assert.match(content(0), /Day 1 starts 00:00 UTC Tue 1 Dec\./);
});
