import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { registerDiscordMember } from "../src/lib/server/auth";
import { leadershipReminderMessage, membersWithoutWeeklyUpdate, type LeadershipTask, reminderMessage, sendWeeklyReminder, shoutoutMessage } from "../src/lib/server/reminders";
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

  const sent: { url: string; body: { content: string; username: string; avatar_url: string; allowed_mentions: { users: string[]; parse: string[] } } }[] = [];
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
  // Same name and crest as the Turmoil bot, not the webhook's own name and a blank icon.
  assert.equal(sent[0].body.username, "Turmoil");
  assert.equal(sent[0].body.avatar_url, "https://tracker.example/app-icons/icon-maskable-512.png");
});

test("automatic posts are English only (the translation bot handles other languages)", () => {
  const otherScripts = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]|\u{1F1F9}\u{1F1FC}|\u{1F1E8}\u{1F1F3}|\u{1F1F0}\u{1F1F7}|\u{1F1EC}\u{1F1E7}/u;
  const reminder = reminderMessage(["<@1>"], "https://x");
  assert.match(reminder, /Please save your resources before Clan War Day 1 starts \(Tuesday 00:00 UTC\) \(\+20 Clan Points\): https:\/\/x/);
  assert.doesNotMatch(reminder, otherScripts);
  const shoutout = shoutoutMessage(["🥇 <@1> — 3 (8 wk)"], "https://x/snipes");
  assert.match(shoutout, /Thank you to everyone who joined last week's snipes!/);
  assert.doesNotMatch(shoutout, otherScripts);
  const leadership = leadershipReminderMessage({ tasks: ["warday", "clanDays", "war", "vials"], warDay: { day: 2, endsAt: new Date("2026-10-22T00:00:00Z") }, nextWar: true }, "https://x", ["<@1>"]);
  assert.match(leadership, /Day 2 war points[\s\S]*Clan days for the next war[\s\S]*Clan war results[\s\S]*Clan tech vial donations/);
  assert.doesNotMatch(leadership, otherScripts);
});

test("leadership reminders ping the Clan Hub admins, only when a job is still undone", async () => {
  const { randomUUID } = await import("node:crypto");
  const { initializeSchema, openDatabase } = await import("../src/lib/server/db");
  const { sendLeadershipReminder } = await import("../src/lib/server/reminders");
  const db = await openDatabase({ localPath: "memory://" });
  const previous = process.env.DISCORD_BOT_TOKEN;
  try {
    await initializeSchema(db);
    process.env.DISCORD_BOT_TOKEN = "bot";
    const posts: { url: string; body: { content: string; allowed_mentions: unknown; flags: number } }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => { posts.push({ url, body: JSON.parse(String(init?.body)) }); return new Response("{}"); }) as unknown as typeof fetch;
    const admin = (await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,'111','leader','ADMIN') RETURNING id", [randomUUID()]))[0].id;
    await db.query("INSERT INTO app_members (id,discord_id,username,role,holiday_until) VALUES ($1,'222','away','ADMIN','2026-12-31')", [randomUUID()]);
    await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,'333','member','MEMBER')", [randomUUID()]);
    const send = (now: string, tasks: LeadershipTask[]) => sendLeadershipReminder({ db, fetcher, now: new Date(now), tasks });
    const last = () => posts[posts.length - 1].body;

    // Sunday: vials for the race week that ends Monday 00:00 UTC.
    const sunday = "2026-10-18T10:00:00Z";
    assert.deepEqual(await send(sunday, ["vials"]), { posted: true, missing: ["vials"], pinged: 1 });
    assert.match(posts[0].url, /channels\/1504758222974746645\/messages/);
    // Only admins are pinged, not the one on holiday or ordinary members, and never roles.
    assert.deepEqual(last().allowed_mentions, { parse: [], users: ["111"] });
    assert.match(last().content, /^📌 \*\*Leadership reminder\*\*\n<@111>\n/);
    assert.match(last().content, /vial donations[^\n]*https:\/\/tracker\.example\/vial-donations/);
    assert.doesNotMatch(last().content, /<@222>|<@333>|Clan war results/);
    assert.equal(last().flags, 4);
    await db.query("INSERT INTO war_results (id, week_start, label, created_by, kind) VALUES ($1, '2026-10-12', '', $2, 'vials')", [randomUUID(), admin]);
    assert.equal((await send(sunday, ["vials"])).posted, false);

    // Monday (Day 7): results of the war that ran 13–19 October, and the clan days for the war starting on the 20th.
    const monday = "2026-10-19T10:00:00Z";
    assert.deepEqual((await send(monday, ["war", "clanDays"])).missing, ["clanDays", "war"]);
    assert.match(last().content, /Clan days for the next war\*\*: pick them before Day 1 starts \(Tuesday 00:00 UTC\) → https:\/\/tracker\.example\/war\n[\s\S]*Clan war results/);
    await db.query("INSERT INTO war_results (id, week_start, label, created_by, kind) VALUES ($1, '2026-10-12', '', $2, 'war')", [randomUUID(), admin]);
    assert.deepEqual((await send(monday, ["war", "clanDays"])).missing, ["clanDays"]);
    assert.doesNotMatch(last().content, /Clan war results/);
    // Picked for the next war (its week is the Monday before its Day 1): nothing left to remind.
    await db.query("INSERT INTO clan_war_days (war_week, days, updated_by) VALUES ('2026-10-19', '1,3', $1)", [admin]);
    assert.equal((await send(monday, ["war", "clanDays"])).posted, false);

    // Day 1 (Tuesday 20 October), evening: today's daily points, due before 00:00 UTC.
    const day1 = "2026-10-20T21:00:00Z";
    assert.deepEqual((await send(day1, ["warday"])).missing, ["warday"]);
    assert.match(last().content, /Day 1 war points\*\*: add today's clan war screenshot before Day 1 ends at 00:00 UTC \(<t:1792540800:R>\)/);
    assert.match(last().content, /tap \*\*Day 1\*\*/);
    await db.query("INSERT INTO war_results (id, week_start, label, created_by, kind, war_day) VALUES ($1, '2026-10-19', '', $2, 'warday', 1)", [randomUUID(), admin]);
    assert.equal((await send(day1, ["warday"])).posted, false);
    // Day 2 needs its own upload. Day 6 (the battle) and Day 7 (claiming) have none.
    assert.deepEqual((await send("2026-10-21T21:00:00Z", ["warday"])).missing, ["warday"]);
    assert.match(last().content, /Day 2 war points/);
    assert.equal((await send("2026-10-25T21:00:00Z", ["warday"])).posted, false);
    assert.equal((await send("2026-10-26T10:00:00Z", ["warday"])).posted, false);
    assert.equal(posts.length, 5);
  } finally {
    if (previous === undefined) delete process.env.DISCORD_BOT_TOKEN; else process.env.DISCORD_BOT_TOKEN = previous;
    await db.close();
  }
});
