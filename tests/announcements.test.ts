import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { memberFromRow } from "../src/lib/server/mappers";
import { announcementChannels, announcementSchema, channelWords, deleteAnnouncement, postAnnouncement } from "../src/lib/server/announcements";
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
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
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
  assert.deepEqual(result, { channel: "📊-turmoil-resource-tracker", messageId: "555", via: "bot" });
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

function botBlocked(webhookChannel: string) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/guilds/999/channels")) return Response.json([{ id: "2", name: "turmoil-resource-tracker", type: 0 }]);
    if (url.endsWith("/channels/2/messages")) return Response.json({ message: "Missing Permissions", code: 50013 }, { status: 403 });
    if (url === "https://discord.com/api/webhooks/7/secret") return Response.json({ channel_id: webhookChannel });
    if (url === "https://discord.com/api/webhooks/7/secret?wait=true") return Response.json({ id: "777" });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

test("when the bot can't post there, the reminder webhook in that channel posts instead", async () => {
  process.env.DISCORD_REMINDER_WEBHOOK_URL = "https://discord.com/api/webhooks/7/secret";
  try {
    const { calls, fetcher } = botBlocked("2");
    const result = await postAnnouncement(await member("ADMIN"), { channel: "turmoil resource tracker", content: "Hi" }, { db, fetcher });
    assert.deepEqual(result, { channel: "turmoil-resource-tracker", messageId: "777", via: "webhook" });
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("?wait=true")));
  } finally { delete process.env.DISCORD_REMINDER_WEBHOOK_URL; }
});

test("a webhook in a different channel is never used, and Discord's reason is shown", async () => {
  process.env.DISCORD_REMINDER_WEBHOOK_URL = "https://discord.com/api/webhooks/7/secret";
  try {
    const { calls, fetcher } = botBlocked("other-channel");
    await assert.rejects(
      postAnnouncement(await member("ADMIN"), { channel: "turmoil resource tracker", content: "Hi" }, { db, fetcher }),
      (error: unknown) => error instanceof ApiError && error.status === 502 && /Missing Permissions, 50013/.test(error.message) && !/secret/.test(error.message),
    );
    assert.ok(!calls.some((call) => call.url.endsWith("?wait=true")));
  } finally { delete process.env.DISCORD_REMINDER_WEBHOOK_URL; }
});

test("an unknown channel is refused and lists the channels the bot can see", async () => {
  const { calls, fetcher } = fakeDiscord();
  await assert.rejects(
    postAnnouncement(await member("ADMIN"), { channel: "applications", content: "Hi" }, { db, fetcher }),
    (error: unknown) => error instanceof ApiError && error.status === 404 && /general, 📊-turmoil-resource-tracker/.test(error.message),
  );
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("a guide post has gold cards with screenshots and an Open button, still with no pings", async () => {
  const { calls, fetcher } = fakeDiscord();
  const input = announcementSchema.parse({
    channel: "general",
    content: "New on the Clan Hub",
    embeds: [{ title: "1. Tap War", description: "Then Spending Order.", image: "https://tracker.example/guides/step-1.png" }, { title: "2. Pick a line" }],
    button: { label: "Open the Spending Order", url: "https://tracker.example/spending-order" },
  });
  await postAnnouncement(await member("ADMIN"), input, { db, fetcher });
  const post = calls.find((call) => call.method === "POST");
  assert.deepEqual(post?.body, {
    content: "New on the Clan Hub",
    allowed_mentions: { parse: [] },
    // No flags: "no link previews" would hide the cards too.
    embeds: [
      { color: 0xe6bd59, title: "1. Tap War", description: "Then Spending Order.", image: { url: "https://tracker.example/guides/step-1.png" } },
      { color: 0xe6bd59, title: "2. Pick a line" },
    ],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: "Open the Spending Order", url: "https://tracker.example/spending-order" }] }],
  });
  assert.throws(() => announcementSchema.parse({ channel: "general", content: "Hi", embeds: [{ title: "x", image: "http://insecure.example/a.png" }] }));
});

test("through the webhook, a guide post goes without its button", async () => {
  process.env.DISCORD_REMINDER_WEBHOOK_URL = "https://discord.com/api/webhooks/7/secret";
  try {
    const { calls, fetcher } = botBlocked("2");
    await postAnnouncement(await member("ADMIN"), { channel: "turmoil resource tracker", content: "Hi", embeds: [{ title: "Step" }], button: { label: "Open", url: "https://tracker.example" } }, { db, fetcher });
    const hooked = calls.find((call) => call.url.endsWith("?wait=true"));
    assert.equal(hooked?.body?.components, undefined);
    assert.deepEqual(hooked?.body?.embeds, [{ color: 0xe6bd59, title: "Step" }]);
  } finally { delete process.env.DISCORD_REMINDER_WEBHOOK_URL; }
});

test("admins can list the channels a post can go in, without posting", async () => {
  const { calls, fetcher } = fakeDiscord();
  assert.deepEqual(await announcementChannels(await member("ADMIN"), { db, fetcher }), { channels: [{ id: "1", name: "general" }, { id: "2", name: "📊-turmoil-resource-tracker" }] });
  assert.ok(calls.every((call) => call.method === "GET"));
  await assert.rejects(announcementChannels(await member("MEMBER"), { db, fetcher }), (error: unknown) => error instanceof ApiError && error.status === 403);
});

test("a leader can ask to ping @everyone, and only @everyone", async () => {
  const { calls, fetcher } = fakeDiscord();
  await postAnnouncement(await member("ADMIN"), { channel: "general", content: "📢 New on the Clan Hub", pingEveryone: true }, { db, fetcher });
  const post = calls.find((call) => call.method === "POST");
  assert.equal(post?.body?.content, "@everyone\n📢 New on the Clan Hub");
  assert.deepEqual(post?.body?.allowed_mentions, { parse: ["everyone"] });
  // Already starting with @everyone: not added twice.
  calls.length = 0;
  await postAnnouncement(await member("ADMIN"), { channel: "general", content: "@everyone hello", pingEveryone: true }, { db, fetcher });
  assert.equal(calls.find((call) => call.method === "POST")?.body?.content, "@everyone hello");
});

test("an admin can delete the bot's post, or the webhook's in that channel; members can't", async () => {
  const { calls, fetcher } = fakeDiscord();
  assert.deepEqual(await deleteAnnouncement(await member("ADMIN"), { channel: "general", messageId: "123456789" }, { db, fetcher }), { channel: "general", messageId: "123456789", via: "bot" });
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url === "https://discord.com/api/v10/channels/1/messages/123456789"));
  await assert.rejects(deleteAnnouncement(await member("MEMBER"), { channel: "general", messageId: "123456789" }, { db, fetcher }), (error: unknown) => error instanceof ApiError && error.status === 403);
  process.env.DISCORD_REMINDER_WEBHOOK_URL = "https://discord.com/api/webhooks/7/secret";
  try {
    const removed: string[] = [];
    const webhookOnly = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/guilds/999/channels")) return Response.json([{ id: "2", name: "turmoil-resource-tracker", type: 0 }]);
      if (url.endsWith("/channels/2/messages/987654321")) return Response.json({ message: "Missing Permissions", code: 50013 }, { status: 403 });
      if (url === "https://discord.com/api/webhooks/7/secret") return Response.json({ channel_id: "2" });
      if (url === "https://discord.com/api/webhooks/7/secret/messages/987654321" && init?.method === "DELETE") { removed.push(url); return new Response(null, { status: 204 }); }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    assert.equal((await deleteAnnouncement(await member("ADMIN"), { channel: "turmoil resource tracker", messageId: "987654321" }, { db, fetcher: webhookOnly })).via, "webhook");
    assert.equal(removed.length, 1);
  } finally { delete process.env.DISCORD_REMINDER_WEBHOOK_URL; }
});
