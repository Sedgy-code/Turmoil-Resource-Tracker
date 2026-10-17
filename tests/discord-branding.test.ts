import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { brandBot } from "../src/lib/server/discord-branding";

const previous = { ...process.env };
before(() => { Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_BOT_TOKEN: "bot", DISCORD_GUILD_ID: "999" }); });
after(() => { process.env = previous; });

test("the bot gets the Turmoil nickname, username and crest picture", async () => {
  const calls: { url: string; method: string; body?: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "https://tracker.example/app-icons/icon-maskable-512.png") return new Response(new Uint8Array([137, 80, 78, 71]));
    return Response.json({});
  }) as typeof fetch;
  const result = await brandBot(fetcher);
  assert.deepEqual(result, { nickname: true, username: true, avatar: true, problems: [] });
  assert.deepEqual(calls.find((call) => call.url.endsWith("/guilds/999/members/@me"))?.body, { nick: "Turmoil" });
  const profile = calls.find((call) => call.url.endsWith("/users/@me"));
  assert.equal(profile?.body?.username, "Turmoil");
  assert.equal(profile?.body?.avatar, "data:image/png;base64,iVBORw==");
});

test("each part is tried on its own and Discord's reason is reported", async () => {
  const fetcher = (async (url: string) => {
    if (url.endsWith("/members/@me")) return Response.json({ message: "Missing Permissions" }, { status: 403 });
    if (url.endsWith(".png")) return new Response(new Uint8Array([1]));
    return Response.json({});
  }) as typeof fetch;
  const result = await brandBot(fetcher);
  assert.equal(result.nickname, false);
  assert.equal(result.username, true);
  assert.deepEqual(result.problems, ["nickname: Missing Permissions"]);
});
