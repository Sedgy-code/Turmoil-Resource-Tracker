import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { handleInteraction } from "../src/lib/server/discord-interactions";
import { agreesToRules } from "../src/lib/server/discord-applications";

const previous = { ...process.env };
before(() => {
  Object.assign(process.env, { NODE_ENV: "test", APP_URL: "https://tracker.example", DISCORD_BOT_TOKEN: "bot", DISCORD_GUILD_ID: "999" });
  delete process.env.DISCORD_ROLE_ID;
  delete process.env.DISCORD_APPLICATIONS_CHANNEL_ID;
});
after(() => { process.env = previous; });

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
  try { await initializeSchema(db); await work(db); } finally { await db.close(); }
}

async function addMember(db: Database, discordId: string, username: string, role: "ADMIN" | "MEMBER" = "MEMBER") {
  await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,$2,$3,$4)", [randomUUID(), discordId, username, role]);
}

type Call = { url: string; method: string; body?: Record<string, unknown> };
function fakeDiscord(options: { leadershipOk?: boolean; dmOk?: boolean } = {}) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith("/channels/1560839494612295741/messages"))
      return options.leadershipOk === false ? Response.json({ message: "Missing Permissions", code: 50013 }, { status: 403 }) : Response.json({ id: "m1" });
    if (url.endsWith("/guilds/999/roles")) return Response.json([{ id: "r1", name: "Turmoil" }, { id: "r2", name: "Leadership" }]);
    if (url.endsWith("/roles/r1") && init?.method === "PUT") return new Response(null, { status: 204 });
    if (url.endsWith("/users/@me/channels")) return options.dmOk === false ? Response.json({ message: "Cannot send messages to this user" }, { status: 403 }) : Response.json({ id: "dm1" });
    if (url.endsWith("/channels/dm1/messages")) return Response.json({ id: "dm-message" });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

const button = (discordId: string, customId: string, content?: string) =>
  ({ type: 3, guild_id: "999", member: { user: { id: discordId, username: "guest" } }, message: { content }, data: { custom_id: customId } });

function form(discordId: string, gameName = "Kael", agree = "I agree") {
  const values: Record<string, string> = { game_name: gameName, power: "25B", server: "27", about: "English, online daily", agree };
  return {
    type: 5,
    guild_id: "999",
    member: { user: { id: discordId, username: "kael", global_name: "Kael" } },
    data: { custom_id: "apply:form", components: Object.entries(values).map(([id, value]) => ({ type: 1, components: [{ type: 4, custom_id: id, value }] })) },
  };
}

type Reply = { type: number; data: { content?: string; flags?: number; components?: { components: { custom_id: string }[] }[]; custom_id?: string } };

test("the Apply button opens the form for guests, but not for members or people already waiting", async () => {
  await withDatabase(async (db) => {
    const { fetcher } = fakeDiscord();
    const opened = await handleInteraction(button("900", "apply:open"), db, new Date(), fetcher) as Reply;
    assert.equal(opened.type, 9);
    assert.equal(opened.data.components?.length, 5);

    await addMember(db, "901", "Member");
    const member = await handleInteraction(button("901", "apply:open"), db, new Date(), fetcher) as Reply;
    assert.match(String(member.data.content), /already in Turmoil/);

    await handleInteraction(form("900"), db, new Date(), fetcher);
    const again = await handleInteraction({ type: 2, guild_id: "999", member: { user: { id: "900" } }, data: { name: "apply" } }, db, new Date(), fetcher) as Reply;
    assert.match(String(again.data.content), /already applied/);
  });
});

test("a sent form goes to leadership with Accept / Decline, and the applicant is thanked privately", async () => {
  await withDatabase(async (db) => {
    const { calls, fetcher } = fakeDiscord();
    const reply = await handleInteraction(form("900"), db, new Date(), fetcher) as Reply;
    assert.equal(reply.data.flags, 64);
    assert.match(String(reply.data.content), /Thanks, Kael!/);
    const post = calls.find((call) => call.url.endsWith("/channels/1560839494612295741/messages"));
    assert.ok(post);
    assert.match(String(post.body?.content), /In-game name:\*\* Kael[\s\S]*Power:\*\* 25B[\s\S]*Clan rules:\*\* ✅ agreed/);
    assert.deepEqual(post.body?.allowed_mentions, { parse: [] });
    const ids = (post.body?.components as Reply["data"]["components"])![0].components.map((component) => component.custom_id);
    assert.match(ids[0], /^apply:accept:[0-9a-f-]{36}$/);
    assert.match(ids[1], /^apply:decline:[0-9a-f-]{36}$/);
    const rows = await db.query("SELECT status, message_id FROM discord_applications WHERE discord_id = '900'");
    assert.deepEqual({ status: rows[0].status, message_id: rows[0].message_id }, { status: "pending", message_id: "m1" });
  });
});

test("only admins can answer; accepting gives the Turmoil role and DMs the applicant", async () => {
  await withDatabase(async (db) => {
    await addMember(db, "1", "Leader", "ADMIN");
    await addMember(db, "2", "Member");
    const { calls, fetcher } = fakeDiscord();
    await handleInteraction(form("900"), db, new Date(), fetcher);
    const accept = String(calls[0].body && (calls[0].body.components as Reply["data"]["components"])![0].components[0].custom_id);

    const refused = await handleInteraction(button("2", accept), db, new Date(), fetcher) as Reply;
    assert.match(String(refused.data.content), /Only clan admins/);

    const answered = await handleInteraction(button("1", accept, "📝 **New application**"), db, new Date(), fetcher) as Reply;
    assert.equal(answered.type, 7);
    assert.deepEqual(answered.data.components, []);
    assert.match(String(answered.data.content), /Accepted\*\* by Leader · Turmoil role given · DM sent/);
    assert.ok(calls.some((call) => call.method === "PUT" && call.url.endsWith("/guilds/999/members/900/roles/r1")));
    const dm = calls.find((call) => call.url.endsWith("/channels/dm1/messages"));
    assert.match(String(dm?.body?.content), /Welcome to Turmoil![\s\S]*https:\/\/tracker\.example/);
    assert.equal((await db.query("SELECT status FROM discord_applications"))[0].status, "accepted");

    const twice = await handleInteraction(button("1", accept), db, new Date(), fetcher) as Reply;
    assert.match(String(twice.data.content), /Already accepted by Leader/);
  });
});

test("declining sends a kind DM, gives no role, and closed DMs are reported to leadership", async () => {
  await withDatabase(async (db) => {
    await addMember(db, "1", "Leader", "ADMIN");
    const { calls, fetcher } = fakeDiscord({ dmOk: false });
    await handleInteraction(form("900"), db, new Date(), fetcher);
    const decline = String((calls[0].body!.components as Reply["data"]["components"])![0].components[1].custom_id);
    const answered = await handleInteraction(button("1", decline, "📝 **New application**"), db, new Date(), fetcher) as Reply;
    assert.match(String(answered.data.content), /Declined\*\* by Leader · ⚠️ couldn’t DM them/);
    assert.ok(!calls.some((call) => call.method === "PUT"));
  });
});

test("/apply-setup is for admins and posts the Apply button", async () => {
  await withDatabase(async (db) => {
    await addMember(db, "1", "Leader", "ADMIN");
    await addMember(db, "2", "Member");
    const { fetcher } = fakeDiscord();
    const command = (discordId: string) => ({ type: 2, guild_id: "999", member: { user: { id: discordId } }, data: { name: "apply-setup" } });
    const refused = await handleInteraction(command("2"), db, new Date(), fetcher) as Reply;
    assert.match(String(refused.data.content), /Only clan admins/);
    const posted = await handleInteraction(command("1"), db, new Date(), fetcher) as Reply;
    assert.equal(posted.type, 4);
    assert.equal(posted.data.flags, undefined);
    assert.equal(posted.data.components?.[0].components[0].custom_id, "apply:open");
    assert.match(String(posted.data.content), /Want to join Turmoil\?[\s\S]*Clan Hub[\s\S]*black mark[\s\S]*Clan Tech Vials[\s\S]*will be removed[\s\S]*20B\+ power/);
  });
});

test("if leadership can't be reached, the applicant is told and can try again", async () => {
  await withDatabase(async (db) => {
    const { fetcher } = fakeDiscord({ leadershipOk: false });
    const reply = await handleInteraction(form("900"), db, new Date(), fetcher) as Reply;
    assert.match(String(reply.data.content), /couldn’t be sent/);
    const retry = await handleInteraction(button("900", "apply:open"), db, new Date(), fetcher) as Reply;
    assert.equal(retry.type, 9);
  });
});

test("applicants must agree to the clan rules", async () => {
  assert.equal(agreesToRules("I agree"), true);
  assert.equal(agreesToRules("yes I AGREE."), true);
  assert.equal(agreesToRules("I don't agree"), false);
  assert.equal(agreesToRules("disagree"), false);
  assert.equal(agreesToRules("ok"), false);
  await withDatabase(async (db) => {
    const { calls, fetcher } = fakeDiscord();
    const reply = await handleInteraction(form("900", "Kael", "maybe"), db, new Date(), fetcher) as Reply;
    assert.match(String(reply.data.content), /need to agree to our clan rules/);
    assert.equal(calls.length, 0);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM discord_applications"))[0].n, 0);
  });
});
