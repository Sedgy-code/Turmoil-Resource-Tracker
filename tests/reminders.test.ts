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
