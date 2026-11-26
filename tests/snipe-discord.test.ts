import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { memberFromRow } from "../src/lib/server/mappers";
import { checkIn } from "../src/lib/server/discord-interactions";
import { cancelSnipe, checkInToSnipe, listSnipes, openSnipeCount, respondToSnipe, snipesToAnswer, updateSnipe } from "../src/lib/server/planning";
import { assembleMessages, assembleSnipers, cancelMessages, catchUpSnipeRoles, giveSnipeRole, postSnipePlan, refreshSnipePost, SNIPE_CHANNEL_ID, snipePlanMessage, snipeRoleId, tellSnipersCancelled } from "../src/lib/server/snipe-discord";

let db: Database;
const previous = { ...process.env };
const bossId = randomUUID();
const annId = randomUUID();
const bobId = randomUUID();
const cyId = randomUUID();
const goneId = randomUUID();
const snipeId = randomUUID();
// Day 3 of the war that started on Tuesday 20 Oct 2026: the snipe starts 15 minutes before reset.
const startsAt = "2026-10-22T23:45:00.000Z";
const now = new Date("2026-10-22T23:20:00Z");
const API = "https://discord.com/api/v10";

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_BOT_TOKEN: "bot-token", DISCORD_GUILD_ID: "999" });
  for (const name of ["DEMO_MODE", "DISCORD_SERVER_ID", "DISCORD_SNIPE_ROLE_ID", "DISCORD_SNIPE_ROLE_NAME", "DISCORD_SNIPE_CHANNEL_ID"]) delete process.env[name];
  db = await openDatabase();
  await initializeSchema(db);
  await db.query(
    `INSERT INTO app_members (id, discord_id, username, role, active) VALUES
     ($1, '100', 'Boss', 'ADMIN', TRUE), ($2, '200', 'Ann', 'MEMBER', TRUE), ($3, '300', 'bob', 'MEMBER', TRUE),
     ($4, '400', 'Cy', 'MEMBER', TRUE), ($5, '500', 'Gone', 'MEMBER', FALSE)`,
    [bossId, annId, bobId, cyId, goneId],
  );
  await db.query(`INSERT INTO snipe_plans (id, title, starts_at, activities, created_by)
    VALUES ($1, 'Day 3 – Hammers, Skills, Pets', $2, '["hammers","skillSummons","eggMerges"]'::jsonb, $3)`, [snipeId, startsAt, bossId]);
  // Ann and Bob said Yes, Cy said No; Gone said Yes but has left the clan.
  for (const [member, answer] of [[annId, "yes"], [bobId, "yes"], [cyId, "no"], [goneId, "yes"]]) {
    await db.query("INSERT INTO snipe_responses (snipe_id, member_id, answer) VALUES ($1, $2, $3)", [snipeId, member, answer]);
  }
});
beforeEach(async () => {
  await db.query("DELETE FROM snipe_assemblies");
  delete process.env.DEMO_MODE;
});
after(async () => {
  await db.close();
  process.env = previous;
});

const member = async (id: string) => memberFromRow((await db.query("SELECT * FROM app_members WHERE id = $1", [id]))[0]);

type Call = { method: string; url: string; body?: Record<string, unknown> };

/** A pretend Discord: the Snipe Group role, a server where Ann already has it, and a snipe channel. */
function discord(overrides: { post?: number; grant?: number[]; roles?: { id: string; name: string }[] } = {}) {
  const calls: Call[] = [];
  const grants = [...(overrides.grant ?? [])];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (url === `${API}/guilds/999/roles`) return Response.json(overrides.roles ?? [{ id: "r1", name: "Turmoil" }, { id: "r2", name: "Snipe Group" }]);
    if (url.startsWith(`${API}/guilds/999/members?`)) return Response.json([{ user: { id: "200" }, roles: ["r1", "r2"] }, { user: { id: "300" }, roles: ["r1"] }]);
    if (method === "PUT") {
      const status = grants.shift() ?? 204;
      return status === 429 ? Response.json({ retry_after: 0.01 }, { status }) : new Response(null, { status });
    }
    if (url === `${API}/channels/${SNIPE_CHANNEL_ID}/messages`) {
      const status = overrides.post ?? 200;
      return status === 200 ? Response.json({ id: "m1" }) : Response.json({ message: "Missing Permissions", code: 50013 }, { status });
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

test("saying Yes gives the Snipe Group role, found by its name", async () => {
  const { calls, fetcher } = discord();
  assert.deepEqual(await giveSnipeRole(["300"], fetcher), { given: 1, failed: 0 });
  // One member: no need to read the whole server first.
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url}`), [`GET ${API}/guilds/999/roles`, `PUT ${API}/guilds/999/members/300/roles/r2`]);
  // A role set by id skips the lookup; no Discord id, no call.
  process.env.DISCORD_SNIPE_ROLE_ID = "r7";
  const direct = discord();
  assert.deepEqual(await giveSnipeRole(["300", "not-an-id"], direct.fetcher), { given: 1, failed: 0 });
  assert.deepEqual(direct.calls.map(({ url }) => url), [`${API}/guilds/999/members/300/roles/r7`]);
  delete process.env.DISCORD_SNIPE_ROLE_ID;
  // Renamed? The one role with "snipe" in its name still works; two such roles is too unclear to guess.
  assert.equal(await snipeRoleId("bot-token", discord({ roles: [{ id: "r1", name: "Turmoil" }, { id: "r9", name: "🔫 Snipers" }] }).fetcher), "r9");
  assert.equal(await snipeRoleId("bot-token", discord({ roles: [{ id: "r8", name: "Snipe A" }, { id: "r9", name: "Snipe B" }] }).fetcher), null);
  // Asked to slow down: it waits and tries once more.
  assert.deepEqual(await giveSnipeRole(["300"], discord({ grant: [429, 204] }).fetcher), { given: 1, failed: 0 });
  assert.deepEqual(await giveSnipeRole(["300"], discord({ grant: [403] }).fetcher), { given: 0, failed: 1 });
  // Nothing is sent in the demo.
  process.env.DEMO_MODE = "true";
  const demo = discord();
  assert.deepEqual(await giveSnipeRole(["300"], demo.fetcher), { given: 0, failed: 0 });
  assert.equal(demo.calls.length, 0);
});

test("a leader assembles the snipers in #snipe-chat, pinging only those who said Yes", async () => {
  const { calls, fetcher } = discord();
  await assert.rejects(assembleSnipers(await member(annId), snipeId, { db, fetcher, now }), /administrators/);
  const call = await assembleSnipers(await member(bossId), snipeId, { db, fetcher, now });
  assert.deepEqual(call, { by: "Boss", at: now.toISOString(), count: 2, roleFailed: 0 });
  // The server is read once; only Bob was missing the role. Then one post in the snipe channel.
  assert.deepEqual(calls.map(({ method, url }) => `${method} ${url.split("?")[0]}`), [
    `GET ${API}/guilds/999/roles`,
    `GET ${API}/guilds/999/members`,
    `PUT ${API}/guilds/999/members/300/roles/r2`,
    `POST ${API}/channels/${SNIPE_CHANNEL_ID}/messages`,
  ]);
  const post = calls[3].body!;
  const unix = Date.parse(startsAt) / 1000;
  assert.equal(post.content, [
    "🎯 **Snipers, assemble! Day 3 – Hammers, Skills, Pets**",
    `Starts at 23:45 UTC (<t:${unix}:R>). Called by Boss.`,
    "<@200> <@300>",
    "",
    "Press **Check in** when you join the snipe (+10 Clan Points, once a week).",
  ].join("\n"));
  // Ann and Bob (A–Z), never Cy (No) or Gone (left the clan), and never @everyone or a role.
  assert.deepEqual(post.allowed_mentions, { parse: [], users: ["200", "300"] });
  assert.deepEqual(post.components, [{ type: 1, components: [{ type: 2, style: 3, label: "Check in", emoji: { name: "✅" }, custom_id: `checkin:${snipeId}` }] }]);
  // The card shows who called them, and when.
  const { plans } = await listSnipes(await member(bossId), db);
  assert.deepEqual(plans.find((plan) => plan.id === snipeId)?.assembled, { by: "Boss", at: now.toISOString(), count: 2 });
  // Not again within 10 minutes, even from another leader; after that, yes.
  await assert.rejects(assembleSnipers(await member(bossId), snipeId, { db, fetcher, now: new Date(now.getTime() + 9 * 60_000) }), /last 10 minutes/);
  assert.equal(calls.length, 4);
  const again = await assembleSnipers(await member(bossId), snipeId, { db, fetcher, now: new Date(now.getTime() + 11 * 60_000) });
  assert.equal(again.count, 2);
  // Check-in closes 3 hours after the start, and so do the calls.
  await assert.rejects(assembleSnipers(await member(bossId), snipeId, { db, fetcher, now: new Date(Date.parse(startsAt) + 3 * 3_600_000 + 60_000) }), /snipe is over/);
});

test("a call needs someone who said Yes, and an open snipe", async () => {
  const { calls, fetcher } = discord();
  const empty = randomUUID();
  await db.query("INSERT INTO snipe_plans (id, title, starts_at, activities, created_by) VALUES ($1, 'Day 5 – Hammers', $2, '[\"hammers\"]'::jsonb, $3)", [empty, "2026-10-24T23:30:00Z", bossId]);
  await assert.rejects(assembleSnipers(await member(bossId), empty, { db, fetcher, now }), /Nobody has said Yes/);
  await db.query("UPDATE snipe_plans SET archived = TRUE WHERE id = $1", [empty]);
  await assert.rejects(assembleSnipers(await member(bossId), empty, { db, fetcher, now }), /archived/);
  assert.equal(calls.length, 0);
});

test("a post the bot isn't allowed to make isn't recorded, so it can be tried again", async () => {
  const blocked = discord({ post: 403 });
  await assert.rejects(assembleSnipers(await member(bossId), snipeId, { db, fetcher: blocked.fetcher, now }), /couldn’t post in #snipe-chat/);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM snipe_assemblies"))[0].count, 0);
  // The role can't be given (no permission), but the post still goes out and says so.
  const noRoles = discord({ grant: [403] });
  const call = await assembleSnipers(await member(bossId), snipeId, { db, fetcher: noRoles.fetcher, now });
  assert.deepEqual({ count: call.count, roleFailed: call.roleFailed }, { count: 2, roleFailed: 1 });
});

test("in the demo nothing is posted, but the call is recorded", async () => {
  process.env.DEMO_MODE = "true";
  const { calls, fetcher } = discord();
  const call = await assembleSnipers(await member(bossId), snipeId, { db, fetcher, now });
  assert.equal(call.count, 2);
  assert.equal(calls.length, 0);
});

test("leaders opening Snipes catch up the role for anyone who said Yes earlier", async () => {
  const { calls, fetcher } = discord();
  // Ann already has it; Bob said Yes before the bot gave roles out. Cy said No; Gone left the clan.
  assert.deepEqual(await catchUpSnipeRoles({ db, fetcher, now }), { given: 1, failed: 0 });
  assert.deepEqual(calls.filter(({ method }) => method === "PUT").map(({ url }) => url), [`${API}/guilds/999/members/300/roles/r2`]);
  // At most every 10 minutes.
  assert.equal(await catchUpSnipeRoles({ db, fetcher, now: new Date(now.getTime() + 5 * 60_000) }), null);
  // Once check-in has closed, that snipe's answers no longer count.
  const later = discord();
  assert.deepEqual(await catchUpSnipeRoles({ db, fetcher: later.fetcher, now: new Date(Date.parse(startsAt) + 4 * 3_600_000) }), { given: 0, failed: 0 });
  assert.equal(later.calls.length, 0);
});

test("big calls are split across posts, and names can't add Discord formatting", () => {
  const ids = Array.from({ length: 45 }, (_, index) => String(10_000 + index));
  const posts = assembleMessages({ id: "s1", title: "Day 1 – Hammers, Skills", startsAt }, "Mr_Otto*", ids, new Date(Date.parse(startsAt) + 5 * 60_000));
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((post) => post.allowed_mentions.users.length), [40, 5]);
  assert.match(posts[0].content, /^🎯 \*\*Snipers, assemble! Day 1 – Hammers, Skills\*\*\nStarted at 23:45 UTC/);
  assert.match(posts[0].content, /Called by Mr\\_Otto\\\*\./);
  assert.ok(posts[0].components);
  assert.equal(posts[1].components, undefined);
  assert.equal(posts[1].content, ids.slice(40).map((id) => `<@${id}>`).join(" "));
  assert.ok(posts.every((post) => post.content.length < 2000));
});

test("a leader can cancel a snipe that isn't needed, tell the snipers, and reopen it", async () => {
  // Far enough ahead that answers are still open whenever the test runs.
  const later = randomUUID();
  const start = "2027-01-05T23:30:00.000Z";
  await db.query("INSERT INTO snipe_plans (id, title, starts_at, activities, created_by) VALUES ($1, 'Day 1 – Hammers, Skills', $2, '[\"hammers\",\"skillSummons\"]'::jsonb, $3)", [later, start, bossId]);
  for (const [member, answer] of [[annId, "yes"], [bobId, "yes"], [cyId, "no"]]) {
    await db.query("INSERT INTO snipe_responses (snipe_id, member_id, answer) VALUES ($1, $2, $3)", [later, member, answer]);
  }
  const toAnswer = await snipesToAnswer(bossId, db, now);
  await assert.rejects(cancelSnipe(await member(annId), later, db, now), /administrators/);
  const cancelled = await cancelSnipe(await member(bossId), later, db, now);
  assert.equal(cancelled.plan.archived, true);
  assert.deepEqual(cancelled.plan.cancelled, { by: "Boss", at: now.toISOString() });
  // Ann and Bob said Yes (A–Z), so they're the ones to tell.
  assert.deepEqual(cancelled.snipers, ["200", "300"]);
  const listed = (await listSnipes(await member(bossId), db)).plans.find((plan) => plan.id === later)!;
  assert.deepEqual([listed.archived, listed.cancelled?.by, listed.counts.yes], [true, "Boss", 2]);
  // Closed: no answers, calls, check-ins (Hub or Discord), and it's not a snipe to answer any more.
  await assert.rejects(respondToSnipe(await member(annId), later, { answer: "no" }, db), /was cancelled/);
  await assert.rejects(assembleSnipers(await member(bossId), later, { db, fetcher: discord().fetcher, now }), /was cancelled/);
  await assert.rejects(checkInToSnipe(await member(annId), later, db, new Date(start)), /was cancelled/);
  assert.match(await checkIn("200", later, db, new Date(start)), /was cancelled/);
  assert.equal(await snipesToAnswer(bossId, db, now), toAnswer - 1);
  await assert.rejects(cancelSnipe(await member(bossId), later, db, now), /was cancelled/);
  // Reopen undoes it, answers and all.
  const reopened = await updateSnipe(await member(bossId), later, { archived: false }, db);
  assert.deepEqual([reopened.archived, reopened.cancelled ?? null, reopened.counts.yes], [false, null, 2]);
  assert.equal(await snipesToAnswer(bossId, db, now), toAnswer);
});

test("the snipers are told in #snipe-chat when a snipe is cancelled", async () => {
  const { calls, fetcher } = discord();
  const snipe = { title: "Day 2 – Mounts", startsAt: "2026-10-21T23:30:00.000Z" };
  assert.equal(await tellSnipersCancelled(snipe, "Boss", ["200", "300"], fetcher), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/channels/${SNIPE_CHANNEL_ID}/messages`);
  assert.equal(calls[0].body!.content, "❌ **Snipe cancelled: Day 2 – Mounts** (Wed 21 Oct, 23:30 UTC)\nNo need to join. Called off by Boss. Thanks for being ready!\n<@200> <@300>");
  assert.deepEqual(calls[0].body!.allowed_mentions, { parse: [], users: ["200", "300"] });
  // Discord said no: the cancel still stands, and the leader is told it wasn't posted.
  assert.equal(await tellSnipersCancelled(snipe, "Boss", ["200"], discord({ post: 403 }).fetcher), false);
  assert.equal(cancelMessages(snipe, "Boss", Array.from({ length: 41 }, (_, index) => String(index + 1))).length, 2);
});

test("a new snipe's post says when, what and who planned it, with a button, and never pings", () => {
  const message = snipePlanMessage({ title: "Day 3 – Skills @everyone", startsAt, activities: ["skillSummons", "eggMerges"], cancelled: false }, "Boss_*x*", "https://tracker.example");
  assert.deepEqual(message.allowed_mentions, { parse: [] });
  assert.equal(message.content, "🎯 A new snipe is planned. Say **Yes**, **Maybe** or **No** on the Clan Hub so leaders know who's in.");
  const [embed] = message.embeds;
  assert.equal(embed.title, "🎯 New snipe: Day 3 – Skills @everyone");
  assert.equal(embed.color, 0xe6bd59);
  assert.equal(embed.url, "https://tracker.example/snipes");
  assert.equal(embed.description, [
    `**When:** Thu 22 Oct, 23:45 UTC (<t:${Math.floor(Date.parse(startsAt) / 1000)}:R>)`,
    "**What:** Skill summons, Merge existing eggs/pets",
    "**Planned by:** Boss\\_\\*x\\*",
  ].join("\n"));
  assert.deepEqual(message.components, [{ type: 1, components: [{ type: 2, style: 5, label: "Answer on the Clan Hub", url: "https://tracker.example/snipes" }] }]);
  // Called off: the same post turns grey, says so, and loses its button.
  const off = snipePlanMessage({ title: "Day 3 – Skills", startsAt, activities: ["skillSummons"], cancelled: true }, "Boss", "https://tracker.example");
  assert.equal(off.embeds[0].title, "❌ Cancelled: Day 3 – Skills");
  assert.equal(off.embeds[0].color, 0x80848e);
  assert.deepEqual(off.components, []);
  assert.match(off.content, /called off/);
});

test("planning a snipe posts it once in #snipe-chat; changes and a cancel edit that post", async () => {
  const planId = randomUUID();
  await db.query(`INSERT INTO snipe_plans (id, title, starts_at, activities, created_by)
    VALUES ($1, 'Day 4 – Mounts', '2030-10-24T23:30:00.000Z', '["mountSummons"]'::jsonb, $2)`, [planId, bossId]);
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return Response.json({ id: "777" });
  }) as typeof fetch;
  assert.equal(await postSnipePlan(planId, { db, fetcher }), true);
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [["POST", `${API}/channels/${SNIPE_CHANNEL_ID}/messages`]]);
  assert.deepEqual(calls[0].body?.allowed_mentions, { parse: [] });
  assert.equal((calls[0].body?.embeds as { title: string }[])[0].title, "🎯 New snipe: Day 4 – Mounts");
  assert.equal((await db.query("SELECT discord_message_id FROM snipe_plans WHERE id = $1", [planId]))[0].discord_message_id, "777");
  // Never posted twice.
  assert.equal(await postSnipePlan(planId, { db, fetcher }), false);
  assert.equal(calls.length, 1);

  // A leader moves it: the post shows the new time.
  calls.length = 0;
  await updateSnipe(await member(bossId), planId, { startsAt: "2030-10-24T23:40:00.000Z" }, db);
  assert.equal(await refreshSnipePost(planId, { db, fetcher }), true);
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [["PATCH", `${API}/channels/${SNIPE_CHANNEL_ID}/messages/777`]]);
  assert.match((calls[0].body?.embeds as { description: string }[])[0].description, /Thu 24 Oct, 23:40 UTC/);
  assert.deepEqual(calls[0].body?.allowed_mentions, { parse: [] });

  // Called off: the post says so, without a button.
  calls.length = 0;
  await cancelSnipe(await member(bossId), planId, db);
  assert.equal(await refreshSnipePost(planId, { db, fetcher }), true);
  assert.equal((calls[0].body?.embeds as { title: string }[])[0].title, "❌ Cancelled: Day 4 – Mounts");
  assert.deepEqual(calls[0].body?.components, []);

  // In the demo, or for a snipe never posted, nothing reaches Discord.
  calls.length = 0;
  process.env.DEMO_MODE = "true";
  assert.equal(await postSnipePlan(snipeId, { db, fetcher }), false);
  delete process.env.DEMO_MODE;
  assert.equal(await refreshSnipePost(snipeId, { db, fetcher }), false);
  assert.equal(calls.length, 0);
});

test("if Discord won't take the new snipe's post, the snipe still stands and nothing is kept", async () => {
  const planId = randomUUID();
  await db.query(`INSERT INTO snipe_plans (id, title, starts_at, activities, created_by)
    VALUES ($1, 'Day 5 – Pets', '2026-10-24T23:30:00.000Z', '["eggMerges"]'::jsonb, $2)`, [planId, bossId]);
  const refuse = (async () => Response.json({ message: "Missing Permissions", code: 50013 }, { status: 403 })) as typeof fetch;
  assert.equal(await postSnipePlan(planId, { db, fetcher: refuse }), false);
  assert.equal((await db.query("SELECT discord_message_id FROM snipe_plans WHERE id = $1", [planId]))[0].discord_message_id, null);
});

test("the Snipes tab glows while a snipe is to come or on now, never for one called off or long over", async () => {
  const at = new Date("2031-03-04T12:00:00Z");
  const before = await openSnipeCount(db, at);
  const soon = randomUUID();
  const over = randomUUID();
  await db.query(`INSERT INTO snipe_plans (id, title, starts_at, activities, created_by) VALUES
    ($1, 'Soon', '2031-03-04T23:30:00.000Z', '["hammers"]'::jsonb, $3),
    ($2, 'Over', '2031-03-04T08:00:00.000Z', '["hammers"]'::jsonb, $3)`, [soon, over, bossId]);
  assert.equal(await openSnipeCount(db, at), before + 1, "to come: glows; started 4 hours ago (check-in closed): doesn't");
  assert.equal(await openSnipeCount(db, new Date("2031-03-05T01:00:00Z")), before + 1, "on now (check-in still open): glows");
  await db.query("UPDATE snipe_plans SET archived = TRUE, cancelled_at = $2 WHERE id = $1", [soon, at.toISOString()]);
  assert.equal(await openSnipeCount(db, at), before, "called off: no glow");
});

test("Maybe: pinged on a line of its own in the call, given the role, and told when a snipe is cancelled", async () => {
  const deeId = randomUUID();
  await db.query("INSERT INTO app_members (id, discord_id, username, role, active) VALUES ($1, '600', 'Dee', 'MEMBER', TRUE)", [deeId]);
  const unsure = randomUUID();
  await db.query("INSERT INTO snipe_plans (id, title, starts_at, activities, created_by) VALUES ($1, 'Day 3 – Pets', $2, '[\"eggMerges\"]'::jsonb, $3)", [unsure, startsAt, bossId]);
  for (const [who, answer] of [[annId, "yes"], [deeId, "maybe"], [cyId, "no"]]) {
    await db.query("INSERT INTO snipe_responses (snipe_id, member_id, answer) VALUES ($1, $2, $3)", [unsure, who, answer]);
  }
  const { calls, fetcher } = discord();
  const call = await assembleSnipers(await member(bossId), unsure, { db, fetcher, now });
  assert.deepEqual({ count: call.count, roleFailed: call.roleFailed }, { count: 2, roleFailed: 0 });
  // Dee can't see #snipe-chat without the role either.
  assert.deepEqual(calls.filter(({ method }) => method === "PUT").map(({ url }) => url), [`${API}/guilds/999/members/600/roles/r2`]);
  const post = calls.find(({ method }) => method === "POST")!.body!;
  assert.equal(post.content, [
    "🎯 **Snipers, assemble! Day 3 – Pets**",
    `Starts at 23:45 UTC (<t:${Date.parse(startsAt) / 1000}:R>). Called by Boss.`,
    "<@200>",
    "**Maybe:** <@600>, join if you can!",
    "",
    "Press **Check in** when you join the snipe (+10 Clan Points, once a week).",
  ].join("\n"));
  assert.deepEqual(post.allowed_mentions, { parse: [], users: ["200", "600"] });
  // Only Maybes: the call still goes out, with no Yes line.
  const maybesOnly = assembleMessages({ id: "s2", title: "Day 4 – Hammers", startsAt }, "Boss", [], now, ["600"]);
  assert.equal(maybesOnly[0].content.split("\n")[2], "**Maybe:** <@600>, join if you can!");
  assert.deepEqual(maybesOnly[0].allowed_mentions.users, ["600"]);
  // Yes and Maybe spread over two posts keep their own lines.
  const big = assembleMessages({ id: "s3", title: "Day 4", startsAt }, "Boss", Array.from({ length: 39 }, (_, index) => String(10_000 + index)), now, ["600", "700"]);
  assert.deepEqual(big.map((part) => part.allowed_mentions.users.length), [40, 1]);
  assert.match(big[0].content, /\n\*\*Maybe:\*\* <@600>, join if you can!\n/);
  assert.equal(big[1].content, "**Maybe:** <@700>, join if you can!");
  // Nobody said Yes or Maybe: nothing to call.
  await db.query("DELETE FROM snipe_responses WHERE snipe_id = $1 AND answer <> 'no'", [unsure]);
  await db.query("DELETE FROM snipe_assemblies");
  await assert.rejects(assembleSnipers(await member(bossId), unsure, { db, fetcher, now }), /Nobody has said Yes or Maybe/);

  // Leaders opening Snipes catch up the role for a Maybe too.
  const future = randomUUID();
  await db.query("INSERT INTO snipe_plans (id, title, starts_at, activities, created_by) VALUES ($1, 'Day 1 – Hammers', '2027-02-01T23:45:00Z', '[\"hammers\"]'::jsonb, $2)", [future, bossId]);
  await respondToSnipe(await member(deeId), future, { answer: "maybe" }, db);
  const catchUp = discord();
  assert.deepEqual(await catchUpSnipeRoles({ db, fetcher: catchUp.fetcher, now: new Date("2027-02-01T22:45:00Z") }), { given: 1, failed: 0 });
  assert.deepEqual(catchUp.calls.filter(({ method }) => method === "PUT").map(({ url }) => url), [`${API}/guilds/999/members/600/roles/r2`]);
  // Cancelled: everyone who said Yes or Maybe is told (A–Z), not who said No.
  await respondToSnipe(await member(annId), future, { answer: "yes" }, db);
  await respondToSnipe(await member(cyId), future, { answer: "no" }, db);
  const cancelled = await cancelSnipe(await member(bossId), future, db, new Date("2027-02-01T20:00:00Z"));
  assert.deepEqual(cancelled.snipers, ["200", "600"]);
  assert.deepEqual([cancelled.plan.counts.yes, cancelled.plan.counts.maybe, cancelled.plan.counts.no], [1, 1, 1]);
});
