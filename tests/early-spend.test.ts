import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { EMPTY_RESOURCES, type ResourceValues } from "../src/lib/resources";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import {
  afterEarlyChange, askEarlySpend, closeEarlyTickets, decideEarlySpend, earlyNotice, earlySpendCheck, earlyTicketTitle, EARLY_TOP, handleEarlyInteraction,
  parseResetZone, snipeForZone, zoneFromRoles,
} from "../src/lib/server/early-spend";
import { ApiError } from "../src/lib/server/errors";
import { handleInteraction } from "../src/lib/server/discord-interactions";
import { memberFromRow } from "../src/lib/server/mappers";
import { getSpendingOrder, spendingPost, updateSpendingSettings } from "../src/lib/server/spending-order";
import { earlyAskSchema, earlyDecisionSchema, spendSettingsSchema } from "../src/lib/server/validation";
import type { Member } from "../src/lib/types";

// The war of Monday 23 November 2026: Day 3 (Thursday 26th) is a Skills and Pets clan day, with a
// Skills snipe at 23:30 UTC. Day 1 is a clan day too, with no snipe.
const WEEK = "2026-11-23";
const DAY_2 = new Date("2026-11-25T09:00:00Z");
const SNIPE = "2026-11-26T23:30:00Z";
const GUILD = "guild-1";

// The Turmoil server's time zone roles (#⏲️-pick-your-timezone), as Discord names them.
const ROLES = [
  { id: "r-turmoil", name: "Turmoil" },
  { id: "r-us", name: "Reset 4–6pm · UTC−8 to −6" },
  { id: "r-eu", name: "Reset 11pm–1am · UTC−1 to +1" },
  { id: "r-gulf", name: "Reset 2–4am · UTC+2 to +4" },
  { id: "r-asia", name: "Reset 8–9am · UTC+8 to +9" },
];

let db: Database;
const previous = { ...process.env };
/** Each member's Discord roles, as the fake Discord answers them. */
const discordRoles = new Map<string, string[]>();
const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
const fetcher = (async (url: string, init: RequestInit = {}) => {
  calls.push({ url, method: String(init.method ?? "GET"), body: init.body ? JSON.parse(String(init.body)) : {} });
  if (url.endsWith(`/guilds/${GUILD}/roles`)) return new Response(JSON.stringify(ROLES), { status: 200 });
  const member = /\/guilds\/guild-1\/members\/(.+)$/.exec(url);
  if (member) return new Response(JSON.stringify({ roles: discordRoles.get(decodeURIComponent(member[1])) ?? [] }), { status: 200 });
  // #⏰-early-spend-requests (777): its tags, and a new ticket.
  if (url.endsWith("/channels/777") && (init.method ?? "GET") === "GET") {
    return new Response(JSON.stringify({ available_tags: [
      { id: "tag-wait", name: "Waiting" }, { id: "tag-ok", name: "Approved" }, { id: "tag-no", name: "Declined" }, { id: "tag-off", name: "Cancelled" },
    ] }), { status: 200 });
  }
  if (url.endsWith("/channels/777/threads") && init.method === "POST") return new Response(JSON.stringify({ id: "ticket-1" }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as unknown as typeof fetch;

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_BOT_TOKEN: "bot-token", DISCORD_GUILD_ID: GUILD, DISCORD_SPENDING_CHANNEL_ID: "555", DISCORD_EARLY_CHANNEL_ID: "777" });
  delete process.env.DEMO_MODE;
  db = await openDatabase({ localPath: "memory://" });
  await initializeSchema(db);
});
after(async () => {
  await db.close();
  process.env = previous;
});

async function addMember(username: string, roles: string[] = [], role: "ADMIN" | "MEMBER" = "MEMBER"): Promise<Member> {
  const discordId = `d-${username}`;
  const rows = await db.query("INSERT INTO app_members (id, discord_id, username, role) VALUES ($1, $2, $3, $4) RETURNING *", [randomUUID(), discordId, username, role]);
  discordRoles.set(discordId, roles);
  return memberFromRow(rows[0]);
}
/** Skill tickets at 150 for 5 skills: 37,200 is enough to ascend (Legendary). */
async function saveBank(member: Member, resources: Partial<ResourceValues>) {
  await db.query(`INSERT INTO member_banks (member_id, resources, summoning_costs, planning_details, notes, updated_at, updated_by)
    VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, '', $5, $1)`, [
    member.id, JSON.stringify({ ...EMPTY_RESOURCES, ...resources }), JSON.stringify({ fiveSkills: 150, mount: 50 }),
    JSON.stringify({ skillLevel: 100, mountLevel: 100, eggLevel: 100, newMountMerges: 0, eggMerges: 0, eggSummonMerges: 0, extraMountChancePercent: 0, extraPetSummonPercent: 0, forgeLevel: 30, calculationVersion: 2 }),
    DAY_2.toISOString(),
  ]);
}
const code = (expected: string) => (error: unknown) => error instanceof ApiError && error.code === expected;

test("time zone roles give each member's UTC offsets, and whether a snipe is in their night (11 pm to 7 am)", () => {
  assert.deepEqual(parseResetZone("Reset 4–6pm · UTC−8 to −6"), { name: "Reset 4–6pm · UTC−8 to −6", from: -8, to: -6 });
  assert.deepEqual(parseResetZone("Reset 11pm–1am · UTC-1 to +1"), { name: "Reset 11pm–1am · UTC-1 to +1", from: -1, to: 1 });
  assert.deepEqual(parseResetZone("India UTC+5:30"), { name: "India UTC+5:30", from: 5.5, to: 5.5 });
  assert.equal(parseResetZone("Snipe Group"), null);
  assert.equal(zoneFromRoles(["r-turmoil", "r-asia"], ROLES)?.from, 8);
  assert.equal(zoneFromRoles(["r-turmoil"], ROLES), null);
  const snipe = new Date(SNIPE);
  // 23:30 UTC: the middle of the night in the Gulf, early evening in the US, breakfast in Asia.
  assert.deepEqual(snipeForZone(snipe, parseResetZone(ROLES[3].name)!), { localTime: "01:30–03:30", night: true });
  assert.deepEqual(snipeForZone(snipe, parseResetZone(ROLES[1].name)!), { localTime: "15:30–17:30", night: false });
  assert.deepEqual(snipeForZone(snipe, parseResetZone(ROLES[4].name)!), { localTime: "07:30–08:30", night: false });
  // Western Europe is judged at UTC+0: 23:30 is night.
  assert.deepEqual(snipeForZone(snipe, parseResetZone(ROLES[2].name)!), { localTime: "22:30–00:30", night: true });
});

test("on a snipe day, the top 20 who can ascend may ask; outside their night they must say why", async () => {
  const leader = await addMember("Lead", ["r-asia"], "ADMIN");
  const gulf = await addMember("Gulf", ["r-gulf"]);
  const asia = await addMember("Asia", ["r-asia"]);
  const nozone = await addMember("NoZone", ["r-turmoil"]);
  const short = await addMember("Short", ["r-gulf"]);
  await db.query("INSERT INTO clan_war_days (war_week, days) VALUES ($1, '1,3')", [WEEK]);
  await db.query("INSERT INTO snipe_plans (id, title, starts_at, activities, created_by) VALUES ($1, 'Day 3 – Skills', $2, '[\"skillSummons\"]'::jsonb, $3)", [randomUUID(), SNIPE, leader.id]);
  await saveBank(gulf, { skillTickets: 900_000 });
  await saveBank(asia, { skillTickets: 800_000 });
  await saveBank(nozone, { skillTickets: 700_000 });
  // 18 more with big stockpiles, then Short (enough to be in the line, not to ascend), then one more below the top 20.
  for (let index = 0; index < 18; index++) await saveBank(await addMember(`Filler${index}`, ["r-gulf"]), { skillTickets: 600_000 - index * 1_000 });
  const twentyFirst = await addMember("TwentyFirst", ["r-gulf"]);
  await saveBank(twentyFirst, { skillTickets: 100_000 });
  await saveBank(short, { skillTickets: 20_000 });
  const deps = { db, fetcher, now: DAY_2 };

  // Pets score on Day 3 too, but the snipe is Skills only: nothing to ask for. Day 1 is over.
  const noSnipe = await earlySpendCheck(gulf, { day: 3, resource: "pets" }, deps);
  assert.deepEqual([noSnipe.canAsk, noSnipe.blocked], [false, "No snipe is planned for this line that day, so there’s nothing to spend early for."]);
  assert.equal((await earlySpendCheck(gulf, { day: 1, resource: "skills" }, deps)).blocked, "That clan day is over.");
  assert.equal((await earlySpendCheck(gulf, { day: 2, resource: "skills" }, deps)).blocked, "That isn’t a clan day for this line.");

  // The Gulf: 01:30–03:30, their night. No reason needed.
  const night = await earlySpendCheck(gulf, { day: 3, resource: "skills" }, deps);
  assert.deepEqual([night.canAsk, night.localTime, night.night, night.reasonRequired, night.snipeAt], [true, "01:30–03:30", true, false, new Date(SNIPE).toISOString()]);
  const asked = await askEarlySpend(gulf, { day: 3, resource: "skills", spendAt: "06:30" }, deps);
  assert.deepEqual([asked.status, asked.place, asked.night, asked.reason, asked.spendAt, asked.zone?.from], ["pending", 1, true, "", "2026-11-26T06:30:00.000Z", 2]);
  await assert.rejects(askEarlySpend(gulf, { day: 3, resource: "skills" }, deps), code("EARLY_ALREADY_ASKED"));

  // Asia: 07:30–08:30 is a reasonable time, so they must say why.
  const day = await earlySpendCheck(asia, { day: 3, resource: "skills" }, deps);
  assert.deepEqual([day.canAsk, day.night, day.reasonRequired], [true, false, true]);
  await assert.rejects(askEarlySpend(asia, { day: 3, resource: "skills", reason: " " }, deps), code("EARLY_REASON_NEEDED"));
  await assert.rejects(askEarlySpend(asia, { day: 3, resource: "skills", reason: "At work all morning", spendAt: "23:45" }, deps), code("EARLY_BAD_TIME"));
  await assert.rejects(askEarlySpend(asia, { day: 3, resource: "skills", reason: "At work all morning", spendAt: "6pm" }, deps), code("EARLY_BAD_TIME"));
  const withReason = await askEarlySpend(asia, { day: 3, resource: "skills", reason: "  At work   all morning " }, deps);
  assert.deepEqual([withReason.reason, withReason.spendAt, withReason.night], ["At work all morning", null, false]);

  // No time zone role yet: they can't ask until they pick one.
  const noZone = await earlySpendCheck(nozone, { day: 3, resource: "skills" }, deps);
  assert.deepEqual([noZone.canAsk, noZone.needsZone], [false, true]);
  await assert.rejects(askEarlySpend(nozone, { day: 3, resource: "skills", reason: "Asleep" }, deps), code("EARLY_NO_TIMEZONE"));

  // Below the top 20, or not enough to ascend: no.
  const low = await earlySpendCheck(twentyFirst, { day: 3, resource: "skills" }, deps);
  assert.deepEqual([low.canAsk, low.blocked, low.values], [false, "Only the top {top} in the line can ask. You’re #{place}.", { top: EARLY_TOP, place: 22 }]);
  await assert.rejects(askEarlySpend(twentyFirst, { day: 3, resource: "skills" }, deps), (error) => error instanceof ApiError && error.message === "Only the top 20 in the line can ask. You’re #22.");
  assert.equal((await earlySpendCheck(short, { day: 3, resource: "skills" }, deps)).canAsk, false);

  // Once the snipe has started, it's too late.
  assert.equal((await earlySpendCheck(asia, { day: 3, resource: "skills" }, { db, fetcher, now: new Date("2026-11-26T23:31:00Z") })).blocked, "That snipe has already started.");
});

test("any leader approves or declines (and can change their mind); members can only cancel their own", async () => {
  const [leader, gulf, asia] = await Promise.all(["Lead", "Gulf", "Asia"].map(async (name) => memberFromRow((await db.query("SELECT * FROM app_members WHERE username = $1", [name]))[0])));
  const deps = { db, now: DAY_2 };
  const gulfAsk = (await db.query("SELECT id FROM early_spends WHERE member_id = $1", [gulf.id]))[0].id as string;
  const asiaAsk = (await db.query("SELECT id FROM early_spends WHERE member_id = $1", [asia.id]))[0].id as string;
  await assert.rejects(decideEarlySpend(asia, { id: gulfAsk, status: "approved" }, deps), code("ADMIN_REQUIRED"));
  await assert.rejects(decideEarlySpend(asia, { id: gulfAsk, status: "cancelled" }, deps), code("EARLY_NOT_YOURS"));
  const approved = await decideEarlySpend(leader, { id: gulfAsk, status: "approved" }, deps);
  assert.deepEqual([approved.status, approved.decidedBy], ["approved", "Lead"]);

  // Everyone sees the requests, and approved members are marked ⏰ in that day's line and post.
  const order = await getSpendingOrder(asia, db, DAY_2);
  const skills = order.orders.find((line) => line.resource === "skills")!;
  assert.deepEqual([skills.day, skills.snipeAt], [3, new Date(SNIPE).toISOString()]);
  assert.deepEqual(skills.rows.filter((row) => row.early).map((row) => row.member.username), ["Gulf"]);
  assert.deepEqual(order.early.map((item) => [item.member.username, item.status]).sort(), [["Asia", "pending"], ["Gulf", "approved"]]);
  const post = spendingPost(3, order.orders, "https://tracker.example", undefined, { week: WEEK });
  assert.match(post.embed.fields[0].value, /^1\. ⏰ Gulf · /);
  assert.match(post.embed.footer, /⏰ approved to spend early/);
  assert.deepEqual(post.embed.ask, { label: "Ask to spend early", customId: `early:ask:${WEEK}:3` });
  assert.equal(spendingPost(3, order.orders, "https://tracker.example").embed.ask, undefined);

  // Declined, then asked again: back to waiting. Cancelled requests drop out of the list.
  await decideEarlySpend(leader, { id: asiaAsk, status: "declined" }, deps);
  await assert.rejects(askEarlySpend(asia, { day: 3, resource: "skills", reason: "No" }, { ...deps, fetcher }), code("EARLY_REASON_NEEDED"));
  const again = await askEarlySpend(asia, { day: 3, resource: "skills", reason: "Kids’ swimming lessons" }, { ...deps, fetcher });
  assert.deepEqual([again.id, again.status, again.decidedBy], [asiaAsk, "pending", null]);
  await decideEarlySpend(asia, { id: asiaAsk, status: "cancelled" }, deps);
  await assert.rejects(decideEarlySpend(leader, { id: asiaAsk, status: "approved" }, deps), code("EARLY_CLOSED"));
  assert.deepEqual((await getSpendingOrder(leader, db, DAY_2)).early.map((item) => item.member.username), ["Gulf"]);

  // The request's Discord message: names only, no pings; a decided one keeps the other button so leaders can change their mind.
  const notice = earlyNotice(approved);
  assert.deepEqual(notice.allowed_mentions, { parse: [] });
  assert.match(notice.content, /⏰ \*\*Early spend request\*\* · Day 3 · 🎟️ Skills/);
  assert.match(notice.content, /🎯 Snipe at 23:30 UTC · 01:30–03:30 for them 🌙 \(Reset 2–4am · UTC\+2 to \+4\)/);
  assert.match(notice.content, /🕒 Spends at 06:30 UTC/);
  assert.match(notice.content, /No reason needed: the snipe is in their night/);
  assert.match(notice.content, /✅ \*\*Approved\*\* by Lead/);
  assert.deepEqual(notice.components[0].components.map((button) => button.custom_id), [`early:decline:${gulfAsk}`]);

  assert.deepEqual(earlyAskSchema.parse({ day: 3, resource: "skills", spendAt: "06:30", reason: null }), { day: 3, resource: "skills", spendAt: "06:30", reason: null });
  assert.throws(() => earlyAskSchema.parse({ day: 6, resource: "skills" }));
  assert.throws(() => earlyDecisionSchema.parse({ id: "x", status: "maybe" }));
  assert.deepEqual(spendSettingsSchema.parse({ earlyDiscord: true }), { earlyDiscord: true });
});

test("Discord: the post's green button opens a short form; each request is a ticket leaders answer in #⏰-early-spend-requests", async () => {
  const [leader, short] = await Promise.all(["Lead", "Short"].map(async (name) => memberFromRow((await db.query("SELECT * FROM app_members WHERE username = $1", [name]))[0])));
  const filler = memberFromRow((await db.query("SELECT * FROM app_members WHERE username = 'Filler0'"))[0]);
  await updateSpendingSettings(leader, { earlyDiscord: true }, { db, now: DAY_2 });
  assert.equal((await getSpendingOrder(leader, db, DAY_2)).post?.earlyDiscord, true);
  // Day 3's post is up (it goes up the day before).
  await db.query("INSERT INTO spending_posts (war_week, war_day, channel_id, thread_id) VALUES ($1, 3, '555', '900')", [WEEK]);
  const tasks: (() => Promise<unknown>)[] = [];
  const later = (task: () => Promise<unknown>) => { tasks.push(task); };
  const press = (discordId: string, customId: string, roles: string[], type = 3, components?: { components: { custom_id: string; value: string }[] }[]) =>
    handleEarlyInteraction(db, { type, member: { user: { id: discordId }, roles }, data: { custom_id: customId, components } }, discordId, DAY_2, fetcher, later) as Promise<{ type: number; data: Record<string, unknown> }>;
  const ask = `early:ask:${WEEK}:3`;

  const stranger = await press("not-a-member", ask, []);
  assert.match(String(stranger.data.content), /not on the Turmoil Clan Hub yet/);
  const noZone = await press(filler.discordId, ask, ["r-turmoil"]);
  assert.match(String(noZone.data.content), /Pick your time zone in <#1559772353473417246> first/);
  const tooLow = await press(short.discordId, ask, ["r-gulf"]);
  assert.match(String(tooLow.data.content), /🎟️ \*\*Skills:\*\* Only the top 20 in the line can ask\. You’re #23\./);
  assert.match(String(tooLow.data.content), /🥚 \*\*Pets:\*\* No snipe is planned/);
  assert.equal(((await press(filler.discordId, `early:ask:2026-11-16:3`, ["r-gulf"])).data.content as string).includes("earlier war"), true);

  // Filler0 is in the top 20 and ready; the snipe is in their night, so the reason is optional.
  const form = await press(filler.discordId, ask, ["r-gulf"]);
  assert.equal(form.type, 9);
  assert.equal(form.data.custom_id, `early:form:${WEEK}:3:skills`);
  const [timeBox, reasonBox] = (form.data.components as { components: Record<string, unknown>[] }[]).map((row) => row.components[0]);
  assert.deepEqual([timeBox.required, reasonBox.required, reasonBox.label], [false, false, "Anything to add? (optional)"]);
  assert.match(String(reasonBox.placeholder), /01:30–03:30 for you, in your night/);

  // The form comes back: the request is saved, and its ticket opens in the leaders' forum afterwards (not in the public post).
  const sent = await press(filler.discordId, `early:form:${WEEK}:3:skills`, ["r-gulf"], 5, [
    { components: [{ custom_id: "spend_time", value: "7:00" }] }, { components: [{ custom_id: "reason", value: "" }] },
  ]);
  assert.match(String(sent.data.content), /✅ Sent! Leadership will approve or decline it soon/);
  calls.length = 0;
  await Promise.all(tasks.splice(0).map((task) => task()));
  const ticket = calls.find((call) => call.method === "POST")!;
  assert.equal(ticket.url, "https://discord.com/api/v10/channels/777/threads");
  assert.deepEqual([ticket.body.name, ticket.body.applied_tags], ["⏳ Day 3 · Skills · Filler0", ["tag-wait"]]);
  const opening = ticket.body.message as { content: string; allowed_mentions: unknown; components: { components: { custom_id: string }[] }[] };
  assert.match(opening.content, /\*\*Filler0\*\* · #4 in line/);
  assert.deepEqual(opening.allowed_mentions, { parse: [] });
  assert.deepEqual(opening.components[0].components.map((button) => button.custom_id.split(":")[1]), ["approve", "decline"]);
  assert.equal(calls.some((call) => call.url.includes("/channels/900/messages") && call.method === "POST"), false);
  const id = (await db.query("SELECT id, notice_channel_id, notice_message_id FROM early_spends WHERE member_id = $1", [filler.id]))[0];
  assert.deepEqual([id.notice_channel_id, id.notice_message_id], ["ticket-1", "ticket-1"]);

  // Only leaders can answer. A leader's answer rewrites the message, then Day 3's post marks them ⏰.
  const notLeader = await press(filler.discordId, `early:approve:${id.id}`, ["r-gulf"]);
  assert.match(String(notLeader.data.content), /Only leaders can approve or decline/);
  const decided = await press(leader.discordId, `early:approve:${id.id}`, ["r-asia"]);
  assert.equal(decided.type, 7);
  assert.match(String(decided.data.content), /✅ \*\*Approved\*\* by Lead/);
  calls.length = 0;
  await Promise.all(tasks.splice(0).map((task) => task()));
  // The ticket's title and tag follow; Discord already rewrote its message.
  const retagged = calls.find((call) => call.method === "PATCH" && call.url.endsWith("/channels/ticket-1"))!;
  assert.deepEqual([retagged.body.name, retagged.body.applied_tags], ["✅ Day 3 · Skills · Filler0", ["tag-ok"]]);
  assert.equal(calls.some((call) => call.url.endsWith("/channels/ticket-1/messages/ticket-1")), false);
  const edit = calls.find((call) => call.method === "PATCH" && call.url.endsWith("/channels/900/messages/900"))!;
  const fields = (edit.body.embeds as { fields: { value: string }[] }[])[0].fields.map((field) => field.value).join("\n");
  assert.match(fields, /⏰ Filler0/);
  // The post now carries the green Ask button next to the Hub link.
  const buttons = (edit.body.components as { components: { custom_id?: string; url?: string; style: number }[] }[])[0].components;
  assert.deepEqual(buttons.map((button) => [button.custom_id ?? button.url, button.style]), [["https://tracker.example/spending-order", 5], [`early:ask:${WEEK}:3`, 3]]);

  // A decision in the Hub rewrites the ticket's message too.
  const declined = await decideEarlySpend(leader, { id: String(id.id), status: "declined" }, { db, now: DAY_2 });
  assert.equal(earlyTicketTitle(declined), "✖️ Day 3 · Skills · Filler0");
  calls.length = 0;
  await afterEarlyChange(declined.id, { db, fetcher, now: DAY_2 });
  const rewritten = calls.find((call) => call.url.endsWith("/channels/ticket-1/messages/ticket-1"))!;
  assert.match(String(rewritten.body.content), /✖️ \*\*Declined\*\* by Lead/);
  assert.deepEqual(calls.find((call) => call.url.endsWith("/channels/ticket-1"))!.body.applied_tags, ["tag-no"]);

  // When Day 3 ends, the daily job closes its tickets (once).
  calls.length = 0;
  assert.equal(await closeEarlyTickets({ db, fetcher, now: new Date("2026-11-26T23:59:00Z") }), 0);
  assert.equal(await closeEarlyTickets({ db, fetcher, now: new Date("2026-11-27T00:06:00Z") }), 1);
  assert.deepEqual(calls.map((call) => [call.method, call.url, call.body.archived]), [["PATCH", "https://discord.com/api/v10/channels/ticket-1", true]]);
  assert.equal(await closeEarlyTickets({ db, fetcher, now: new Date("2026-11-27T00:30:00Z") }), 0);

  // The interactions endpoint sends early: buttons here. Declined, they can ask again: the form opens.
  const routed = await handleInteraction({ type: 3, member: { user: { id: filler.discordId }, roles: ["r-gulf"] } as never, data: { custom_id: ask } }, db, DAY_2, fetcher, later) as { type: number; data: { custom_id: string } };
  assert.deepEqual([routed.type, routed.data.custom_id], [9, `early:form:${WEEK}:3:skills`]);
});
