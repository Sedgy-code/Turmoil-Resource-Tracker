import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { leaderTodo, nudgeMember, nudgeMessage, statusBoard } from "../src/lib/server/leader";
import { updateMySettings } from "../src/lib/server/me";
import { memberHistory } from "../src/lib/server/leadership";
import { memberFromRow } from "../src/lib/server/mappers";
import { currentWeek } from "../src/lib/resources";

let db: Database;
const previous = { ...process.env };
const adminId = randomUUID();
const savedId = randomUUID();
const pendingId = randomUUID();
const quietId = randomUUID();
// Thursday 22 Oct 2026, 12:00 UTC: Day 3 of the war that started on Tuesday.
const thursday = new Date("2026-10-22T12:00:00Z");
const week = currentWeek(thursday);

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_BOT_TOKEN: "bot-token", DISCORD_REMINDER_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc" });
  delete process.env.DEMO_MODE;
  db = await openDatabase();
  await initializeSchema(db);
  await db.query(
    `INSERT INTO app_members (id, discord_id, username, role, reminders_allowed) VALUES
     ($1, '100', 'Boss', 'ADMIN', FALSE), ($2, '200', 'Saver', 'MEMBER', TRUE), ($3, '300', 'Late', 'MEMBER', TRUE), ($4, '400', 'Quiet', 'MEMBER', FALSE)`,
    [adminId, savedId, pendingId, quietId],
  );
  await db.query("INSERT INTO dew_weekly_earnings (member_id, week_start, reason, amount) VALUES ($1, $2, 'resources', 20)", [savedId, week]);
});
beforeEach(async () => {
  await db.query("DELETE FROM member_nudges");
});
after(async () => {
  await db.close();
  process.env = previous;
});

const member = async (id: string) => memberFromRow((await db.query("SELECT * FROM app_members WHERE id = $1", [id]))[0]);

test("the leaders' to-do card shows only jobs that are due today", async () => {
  const snipeId = randomUUID();
  await db.query("INSERT INTO snipe_plans (id, title, starts_at, activities, created_by) VALUES ($1, 'Snipe vs Akatsuki', $2, '[]'::jsonb, $3)",
    [snipeId, new Date(thursday.getTime() - 2 * 3_600_000).toISOString(), adminId]);
  await db.query("INSERT INTO snipe_responses (snipe_id, member_id, answer) VALUES ($1, $2, 'yes')", [snipeId, savedId]);
  const todo = await leaderTodo(await member(adminId), db, thursday);
  assert.deepEqual(todo.warDay, { day: 3, endsAt: "2026-10-23T00:00:00.000Z" });
  assert.deepEqual(todo.clanDays, { nextWar: false, voters: 0 });
  // Vials are due on Day 6 and the end-of-war screenshots on Day 7, not on Day 3.
  assert.equal(todo.vials, null);
  assert.equal(todo.warResults, null);
  assert.deepEqual(todo.attendance.map((item) => [item.title, item.checkedIn, item.saidYes]), [["Snipe vs Akatsuki", 0, 1]]);
  // Boss, Late and Quiet haven't saved this week.
  assert.equal(todo.unsaved, 3);

  const sunday = await leaderTodo(await member(adminId), db, new Date("2026-10-25T12:00:00Z"));
  assert.equal(sunday.warDay, null);
  assert.ok(sunday.vials);
  assert.deepEqual(sunday.clanDays, { nextWar: true, voters: 0 });
  const monday = await leaderTodo(await member(adminId), db, new Date("2026-10-26T12:00:00Z"));
  assert.ok(monday.warResults);
  assert.equal(monday.vials, null);
});

test("only admins see the to-do card and the status board", async () => {
  await assert.rejects(leaderTodo(await member(savedId), db, thursday), /administrators/);
  await assert.rejects(statusBoard(await member(savedId), db, thursday), /administrators/);
});

test("the status board lists members who haven't saved first", async () => {
  const board = await statusBoard(await member(adminId), db, thursday);
  assert.equal(board.week, week);
  assert.deepEqual(board.rows.map((row) => [row.member.username, row.state]), [["Boss", "notStarted"], ["Late", "notStarted"], ["Quiet", "notStarted"], ["Saver", "saved"]]);
  assert.equal(board.rows.find((row) => row.member.username === "Late")?.remindersAllowed, true);
});

test("a nudge goes to a member who allowed it, once a week", async () => {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return url.endsWith("/users/@me/channels") ? Response.json({ id: "555" }) : new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  const nudge = await nudgeMember(await member(adminId), pendingId, { db, fetcher, now: thursday });
  assert.equal(nudge.by, "Boss");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].body, { recipient_id: "300" });
  assert.equal(sent[1].url, "https://discord.com/api/v10/channels/555/messages");
  assert.equal(sent[1].body.content, nudgeMessage("Boss", "https://tracker.example/resources"));
  const board = await statusBoard(await member(adminId), db, thursday);
  assert.equal(board.rows.find((row) => row.member.id === pendingId)?.nudge?.by, "Boss");
  // Once per member per week, even from another leader.
  await assert.rejects(nudgeMember(await member(adminId), pendingId, { db, fetcher, now: thursday }), /already reminded/);
  assert.equal(sent.length, 2);
});

test("nudges respect the member's choice, their time away and their save", async () => {
  const fetcher = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(nudgeMember(await member(adminId), quietId, { db, fetcher, now: thursday }), /allowed Discord reminders/);
  await assert.rejects(nudgeMember(await member(adminId), savedId, { db, fetcher, now: thursday }), /already saved/);
  await assert.rejects(nudgeMember(await member(savedId), pendingId, { db, fetcher, now: thursday }), /administrators/);
});

test("closed messages fall back to a mention in the reminder channel; a failed send is not counted", async () => {
  const sent: string[] = [];
  const closed = (async (url: string) => {
    sent.push(url);
    if (url.endsWith("/users/@me/channels")) return Response.json({ id: "555" });
    if (url.includes("/channels/555/messages")) return new Response(null, { status: 403 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  await nudgeMember(await member(adminId), pendingId, { db, fetcher: closed, now: thursday });
  assert.equal(sent.at(-1), "https://discord.com/api/webhooks/1/abc");
  assert.equal((await db.query("SELECT channel FROM member_nudges WHERE member_id = $1", [pendingId]))[0].channel, "mention");

  await db.query("DELETE FROM member_nudges");
  const down = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(nudgeMember(await member(adminId), pendingId, { db, fetcher: down, now: thursday }), /didn’t deliver/);
  assert.equal((await db.query("SELECT 1 FROM member_nudges")).length, 0);
});

test("members can mark themselves away and allow reminders from the Me page", async () => {
  const me = await member(quietId);
  await assert.rejects(updateMySettings(me, { awayUntil: "2026-10-01" }, db, thursday), /between today and 90 days/);
  await assert.rejects(updateMySettings(me, { awayUntil: "2027-06-01" }, db, thursday), /between today and 90 days/);
  const away = await updateMySettings(me, { awayUntil: "2026-11-05", remindersAllowed: true }, db, thursday);
  assert.equal(away.remindersAllowed, true);
  const history = await memberHistory(await member(adminId), quietId, db);
  assert.ok(history.events.some((event) => event.kind === "holiday" && event.by === "Quiet"));
  const back = await updateMySettings(away, { awayUntil: null }, db, thursday);
  assert.equal(back.holidayUntil, undefined);
  assert.ok((await memberHistory(await member(adminId), quietId, db)).events.some((event) => event.kind === "holiday-ended"));
});
