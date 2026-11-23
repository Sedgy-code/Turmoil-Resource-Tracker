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
  doneUpdateMessage, getSpendingOrder, plainName, postSpendingNow, setSpendingDone, spendingPostContent, spendingPostPreview,
  spendingPostTitle, syncSpendingPosts, updateSpendingSettings,
} from "../src/lib/server/spending-order";
import { spendDoneSchema, spendSettingsSchema } from "../src/lib/server/validation";

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

test("snipers go first, then the biggest stockpile; the first few have a turn and finishing moves the line", () => {
  const members = [person("a", "Ana"), person("b", "Bo"), person("c", "Cy"), person("d", "Di", "2026-11-27"), person("e", "Ed"), person("f", "Fay")];
  const entries = [
    entry("a", { skillTickets: 50_000 }),
    entry("b", { skillTickets: 90_000 }),
    entry("c", { skillTickets: 10_000 }),
    entry("d", { skillTickets: 99_000 }),
    entry("e", { skillTickets: 70_000 }),
    entry("f", {}), // nothing saved for skills: not in the line
  ];
  const input = {
    resource: "skills" as const, members, entries, rates: DEFAULT_WAR_RATES, ascending: new Map([["c", ["skills" as const]]]),
    snipers: new Set(["c"]), done: new Map<string, string | null>(), turns: 2, date: "2026-11-26", day: 3, today: true,
  };
  const line = buildOrder(input);
  assert.deepEqual(line.rows.map((row) => [row.member.username, row.state, row.place]), [
    ["Cy", "turn", 1], ["Bo", "turn", 2], ["Ed", "wait", 3], ["Ana", "wait", 4], ["Di", "away", null],
  ]);
  assert.equal(line.rows[0].sniper, true);
  assert.equal(line.rows[0].ascending, true);
  assert.equal(line.rows[3].ahead, 2);
  // 90,000 tickets at 200 for 5 = 2,250 skill summons × 225 points.
  assert.equal(line.rows[1].points, 2_250 * 225);
  // Bo finishes: Ed moves up to a turn, Bo is listed as done.
  const next = buildOrder({ ...input, done: new Map([["b", null]]) });
  assert.deepEqual(next.rows.map((row) => [row.member.username, row.state]), [["Cy", "turn"], ["Ed", "turn"], ["Ana", "wait"], ["Bo", "done"], ["Di", "away"]]);
});

test("the post says it in English with names only, never pinging anyone", () => {
  assert.equal(spendingPostTitle(3, new Date("2026-11-26T00:00:00Z")), "Day 3 – Skills and Pets · Thu 26 Nov");
  assert.equal(spendingPostTitle(2, new Date("2026-11-25T00:00:00Z")), "Day 2 – Mounts · Wed 25 Nov");
  assert.equal(plainName("*Star*_x @everyone"), "\\*Star\\*\\_x @​everyone");
  const members = [person("a", "Ana"), person("b", "Bo")];
  const line = buildOrder({
    resource: "skills", members, entries: [entry("a", { skillTickets: 50_000 }), entry("b", { skillTickets: 90_000 })], rates: DEFAULT_WAR_RATES,
    ascending: new Map(), snipers: new Set(["a"]), done: new Map(), turns: 1, date: "2026-11-26", day: 3, today: true,
  });
  const text = spendingPostContent(3, [line], "https://tracker.example/spending-order");
  assert.match(text, /Spending order – Day 3 \(clan day\)/);
  assert.match(text, /✅ Your turn \(1 at once\): 🎯 Ana/);
  assert.match(text, /⏳ Next: Bo/);
  assert.match(text, /in today's snipe/);
  assert.doesNotMatch(text, /<@/);
  assert.doesNotMatch(text, /[぀-ヿ一-鿿가-힯]/u);
  assert.equal(doneUpdateMessage("Ana", "skills", true, ["Bo"]), "✅ **Ana** is done with Skills. Your turn now: **Bo**.");
  assert.equal(doneUpdateMessage("Ana", "skills", false, []), "↩️ **Ana** is back in the Skills line.");
});

test("only the three lines and sensible turn counts can be sent", () => {
  assert.deepEqual(spendDoneSchema.parse({ resource: "pets", done: true }), { resource: "pets", done: true });
  assert.throws(() => spendDoneSchema.parse({ resource: "forge", done: true }));
  assert.throws(() => spendDoneSchema.parse({ resource: "pets", done: true, memberId: "not-a-uuid" }));
  assert.deepEqual(spendSettingsSchema.parse({ turns: { skills: 4 } }), { turns: { skills: 4 } });
  assert.throws(() => spendSettingsSchema.parse({ turns: { skills: 0 } }));
  assert.throws(() => spendSettingsSchema.parse({ turns: { forge: 2 } }));
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

test("members finish their own turn, leaders can finish anyone's and set the turns; Days 6–7 look at the next war", async () => {
  const leader = await addMember("Lead", "ADMIN");
  const ana = await addMember("Ana");
  const bo = await addMember("Bo");
  const cy = await addMember("Cy");
  await saveBank(ana, { skillTickets: 80_000, eggsPetsTotal: 900, eggshellsTotal: 40_000 });
  await saveBank(bo, { skillTickets: 60_000, eggsPetsTotal: 100 });
  await saveBank(cy, { skillTickets: 40_000, eggshellsTotal: 5_000 });
  await db.query("INSERT INTO clan_war_days (war_week, days) VALUES ($1, '1,3')", [WEEK]);
  // Bo said Yes to Day 3's skills snipe, so Bo goes first in the Skills line that day.
  const snipe = randomUUID();
  await db.query("INSERT INTO snipe_plans (id, title, starts_at, activities, created_by) VALUES ($1, 'Day 3 – Skills', '2026-11-26T23:30:00Z', '[\"skillSummons\"]'::jsonb, $2)", [snipe, leader.id]);
  await db.query("INSERT INTO snipe_responses (snipe_id, member_id, answer) VALUES ($1, $2, 'yes')", [snipe, bo.id]);

  const onDay2 = await getSpendingOrder(ana, db, DAY_2);
  assert.equal(onDay2.post, undefined); // only leaders see the post's state
  const skills = onDay2.orders.find((line) => line.resource === "skills")!;
  assert.deepEqual([skills.day, skills.today, skills.turns], [3, false, 3]);
  assert.deepEqual(skills.rows.map((row) => row.member.username), ["Bo", "Ana", "Cy"]);
  assert.equal(onDay2.orders.find((line) => line.resource === "mounts")!.day, null);

  await assert.rejects(setSpendingDone(ana, { resource: "skills", done: true, memberId: bo.id }, { db, now: DAY_3 }), (error) => error instanceof ApiError && error.code === "ADMIN_REQUIRED");
  await assert.rejects(updateSpendingSettings(ana, { turns: { skills: 1 } }, { db, now: DAY_3 }), (error) => error instanceof ApiError && error.code === "ADMIN_REQUIRED");
  const fewer = await updateSpendingSettings(leader, { turns: { skills: 1 } }, { db, now: DAY_3 });
  assert.equal(fewer.post?.enabled, false);
  assert.deepEqual(fewer.orders.find((line) => line.resource === "skills")!.rows.map((row) => row.state), ["turn", "wait", "wait"]);
  const mine = await setSpendingDone(bo, { resource: "skills", done: true }, { db, now: DAY_3 });
  assert.deepEqual(mine.orders.find((line) => line.resource === "skills")!.rows.map((row) => [row.member.username, row.state]), [["Ana", "turn"], ["Cy", "wait"], ["Bo", "done"]]);
  const marked = await setSpendingDone(leader, { resource: "skills", done: true, memberId: ana.id }, { db, now: DAY_3 });
  const doneRow = marked.orders.find((line) => line.resource === "skills")!.rows.find((row) => row.member.id === ana.id)!;
  assert.deepEqual([doneRow.state, doneRow.doneBy], ["done", "Lead"]);
  const undone = await setSpendingDone(leader, { resource: "skills", done: false, memberId: ana.id }, { db, now: DAY_3 });
  assert.equal(undone.orders.find((line) => line.resource === "skills")!.rows[0].member.id, ana.id);
  // Battle day: this war's spending is over, so it's the next war's line, and nobody is done yet.
  const battle = await getSpendingOrder(bo, db, DAY_6);
  assert.deepEqual([battle.nextWar, battle.week, battle.clanDays], [true, "2026-11-30", []]);
  assert.ok(battle.orders.every((line) => line.rows.every((row) => row.state !== "done")));
});

test("the clan-day post opens once, follows the line as members finish, and closes when the day ends", async () => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_BOT_TOKEN: "bot-token", DISCORD_SPENDING_CHANNEL_ID: "555" });
  const leader = (await db.query("SELECT * FROM app_members WHERE username = 'Lead'")).map(memberFromRow)[0];
  const ana = (await db.query("SELECT * FROM app_members WHERE username = 'Ana'")).map(memberFromRow)[0];
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method ?? "GET"), body: init.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify(url.endsWith("/threads") ? { id: "777" } : {}), { status: 200 });
  }) as unknown as typeof fetch;

  // Switched off: nothing is posted, and leaders can't post by hand.
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: DAY_3 }), { closed: 0, opened: null, skipped: "switched off" });
  await assert.rejects(postSpendingNow(leader, { db, fetcher, now: DAY_3 }), (error) => error instanceof ApiError && error.code === "SPENDING_POST_OFF");
  const preview = await spendingPostPreview(leader, db, DAY_3);
  assert.deepEqual([preview.day, preview.today, preview.posted, preview.enabled], [3, true, false, false]);
  assert.match(preview.title, /^Day 3 – Skills and Pets · Thu 26 Nov$/);
  assert.equal(calls.length, 0);

  await updateSpendingSettings(leader, { postEnabled: true }, { db, now: DAY_3 });
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: DAY_3 }), { closed: 0, opened: 3 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://discord.com/api/v10/channels/555/threads");
  const message = calls[0].body.message as { content: string; allowed_mentions: unknown };
  assert.deepEqual(message.allowed_mentions, { parse: [] });
  assert.match(message.content, /🎟️ \*\*Skills\*\*/);
  assert.match(message.content, /🥚 \*\*Pets\*\*/);
  assert.match(message.content, /https:\/\/tracker\.example\/spending-order/);
  // A second run the same day opens nothing new.
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: DAY_3 }), { closed: 0, opened: null });
  assert.equal(calls.length, 1);
  await assert.rejects(postSpendingNow(leader, { db, fetcher, now: DAY_3 }), (error) => error instanceof ApiError && error.code === "SPENDING_POST_EXISTS");

  // Ana finishes Skills: the post's first message is rewritten and one line says who's up.
  calls.length = 0;
  await setSpendingDone(ana, { resource: "skills", done: true }, { db, fetcher, now: DAY_3 });
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [
    ["PATCH", "https://discord.com/api/v10/channels/777/messages/777"],
    ["POST", "https://discord.com/api/v10/channels/777/messages"],
  ]);
  assert.match(String(calls[1].body.content), /^✅ \*\*Ana\*\* is done with Skills\./);
  assert.deepEqual(calls[1].body.allowed_mentions, { parse: [] });
  // Mounts don't score on Day 3, so the post isn't touched.
  calls.length = 0;
  await setSpendingDone(ana, { resource: "mounts", done: true }, { db, fetcher, now: DAY_3 }).catch(() => undefined);
  assert.equal(calls.length, 0);

  // Day 4 starts: Day 3's post is archived and locked; Day 4 isn't a clan day, so nothing opens.
  calls.length = 0;
  assert.deepEqual(await syncSpendingPosts({ db, fetcher, now: DAY_4 }), { closed: 1, opened: null });
  assert.deepEqual(calls.map((call) => [call.method, call.url, call.body]), [["PATCH", "https://discord.com/api/v10/channels/777", { archived: true, locked: true }]]);
  assert.equal((await getSpendingOrder(leader, db, DAY_4)).post?.openDay, null);
});
