import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { registerDiscordMember } from "../src/lib/server/auth";
import { membersWithoutWeeklyUpdate, reminderMessage, sendWeeklyReminder } from "../src/lib/server/reminders";
import { currentWeek } from "../src/lib/resources";

let db: Database;
const previous = { ...process.env };

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_REMINDER_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc" });
  db = await openDatabase();
  await initializeSchema(db);
});
after(async () => {
  await db.close();
  process.env = previous;
});

test("only members without this week's resource reward are reminded", async () => {
  const done = await registerDiscordMember({ id: "111111111111111111", username: "Done", avatar: null, discriminator: "0" }, db);
  await registerDiscordMember({ id: "222222222222222222", username: "Pending", avatar: null, discriminator: "0" }, db);
  await db.query("INSERT INTO dew_weekly_earnings (member_id, week_start, reason, amount) VALUES ($1, $2, 'resources', 20)", [done.id, currentWeek()]);
  const pending = await membersWithoutWeeklyUpdate(db);
  assert.deepEqual(pending.map((member) => member.discordId), ["222222222222222222"]);

  const sent: { url: string; body: { content: string; allowed_mentions: { users: string[]; parse: string[] } } }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  const result = await sendWeeklyReminder({ db, fetcher });
  assert.equal(result.pending, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.allowed_mentions, { parse: [], users: ["222222222222222222"] });
  assert.match(sent[0].body.content, /<@222222222222222222>/);
  assert.match(sent[0].body.content, /https:\/\/tracker\.example\/resources/);
});

test("the reminder text includes all four languages", () => {
  const text = reminderMessage(["<@1>"], "https://x");
  for (const phrase of ["Please save", "請在本週", "请在本周", "이번 주"]) assert.ok(text.includes(phrase));
});

test("leadership reminders: vials on Sunday, war results on Monday for the war that just ended", async () => {
  const { randomUUID } = await import("node:crypto");
  const { initializeSchema, openDatabase } = await import("../src/lib/server/db");
  const { sendLeadershipReminder } = await import("../src/lib/server/reminders");
  const db = await openDatabase({ localPath: "memory://" });
  const previous = process.env.DISCORD_BOT_TOKEN;
  try {
    await initializeSchema(db);
    process.env.DISCORD_BOT_TOKEN = "bot";
    const posts: { url: string; body: string }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => { posts.push({ url, body: String(init?.body) }); return new Response("{}"); }) as typeof fetch;
    const admin = (await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,'1','leader','ADMIN') RETURNING id", [randomUUID()]))[0].id;
    const sunday = new Date("2026-10-18T10:00:00Z");
    const monday = new Date("2026-10-19T10:00:00Z");
    assert.deepEqual((await sendLeadershipReminder({ db, fetcher, now: sunday, kinds: ["vials"] })).missing, ["vials"]);
    assert.match(posts[0].url, /channels\/1504758222974746645\/messages/);
    assert.doesNotMatch(posts[0].body, /Clan war results/);
    await db.query("INSERT INTO war_results (id, week_start, label, created_by, kind) VALUES ($1, '2026-10-12', '', $2, 'vials')", [randomUUID(), admin]);
    assert.equal((await sendLeadershipReminder({ db, fetcher, now: sunday, kinds: ["vials"] })).posted, false);
    // Monday is Day 7: the war that ran Tuesday 13 to Monday 19 belongs to the week of the 12th.
    const war = await sendLeadershipReminder({ db, fetcher, now: monday, kinds: ["war"] });
    assert.deepEqual(war.missing, ["war"]);
    assert.match(posts[1].body, /Clan war results/);
    await db.query("INSERT INTO war_results (id, week_start, label, created_by, kind) VALUES ($1, '2026-10-12', '', $2, 'war')", [randomUUID(), admin]);
    assert.equal((await sendLeadershipReminder({ db, fetcher, now: monday, kinds: ["war"] })).posted, false);
    assert.equal(posts.length, 2);
  } finally {
    if (previous === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = previous;
    await db.close();
  }
});
