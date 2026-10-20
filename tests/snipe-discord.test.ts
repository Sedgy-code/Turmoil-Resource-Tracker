import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { memberFromRow } from "../src/lib/server/mappers";
import { listSnipes } from "../src/lib/server/planning";
import { assembleMessages, assembleSnipers, giveSnipeRole, SNIPE_CHANNEL_ID, snipeRoleId } from "../src/lib/server/snipe-discord";

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
