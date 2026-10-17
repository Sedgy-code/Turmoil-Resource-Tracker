import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { memberFromRow } from "../src/lib/server/mappers";
import { channelWords, postAnnouncement } from "../src/lib/server/announcements";
import { ApiError } from "../src/lib/server/errors";

let db: Database;
const previous = { ...process.env };

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test", DISCORD_BOT_TOKEN: "bot", DISCORD_GUILD_ID: "999" });
  db = await openDatabase({ localPath: "memory://" });
  await initializeSchema(db);
});
after(async () => {
  await db.close();
  process.env = previous;
});

async function member(role: "ADMIN" | "MEMBER") {
  const rows = await db.query("INSERT INTO app_members(id,discord_id,username,role) VALUES($1,$2,'Someone',$3) RETURNING *", [randomUUID(), randomUUID(), role]);
  return memberFromRow(rows[0]);
}

function fakeDiscord() {
  const calls: { url: string; method: string; body?: { content: string; allowed_mentions: { parse: string[] }; flags: number } }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/guilds/999/channels"))
      return Response.json([
        { id: "1", name: "general", type: 0 },
        { id: "2", name: "📊-turmoil-resource-tracker", type: 0 },
        { id: "3", name: "Voice", type: 2 },
      ]);
    return Response.json({ id: "555" });
  }) as typeof fetch;
  return { calls, fetcher };
}

test("channel names match however people type them", () => {
  assert.equal(channelWords("📊-turmoil-resource-tracker"), "turmoil resource tracker");
  assert.equal(channelWords("Turmoil Resource Tracker"), "turmoil resource tracker");
});

test("an admin posts as the bot, with no pings and no link previews", async () => {
  const { calls, fetcher } = fakeDiscord();
  const result = await postAnnouncement(await member("ADMIN"), { channel: "turmoil resource tracker", content: "Hello @everyone" }, { db, fetcher });
  assert.deepEqual(result, { channel: "📊-turmoil-resource-tracker", messageId: "555" });
  const post = calls.find((call) => call.method === "POST");
  assert.equal(post?.url, "https://discord.com/api/v10/channels/2/messages");
  assert.deepEqual(post?.body, { content: "Hello @everyone", allowed_mentions: { parse: [] }, flags: 4 });
});

test("members who aren't admins can't post, and nothing reaches Discord", async () => {
  const { calls, fetcher } = fakeDiscord();
  await assert.rejects(
    postAnnouncement(await member("MEMBER"), { channel: "general", content: "Hi" }, { db, fetcher }),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  );
  assert.equal(calls.length, 0);
});

test("an unknown channel is refused and lists the channels the bot can see", async () => {
  const { calls, fetcher } = fakeDiscord();
  await assert.rejects(
    postAnnouncement(await member("ADMIN"), { channel: "applications", content: "Hi" }, { db, fetcher }),
    (error: unknown) => error instanceof ApiError && error.status === 404 && /general, 📊-turmoil-resource-tracker/.test(error.message),
  );
  assert.ok(calls.every((call) => call.method === "GET"));
});
