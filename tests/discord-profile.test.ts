import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { EMPTY_RESOURCES } from "../src/lib/resources";
import { authenticatedMember, createSession, registerDiscordMember } from "../src/lib/server/auth";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { assertGuildMembership, avatarUrl, discordProfile, type DiscordMembership, type DiscordUser } from "../src/lib/server/discord";
import { hashToken } from "../src/lib/server/crypto";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import { copyPreviousEntry, dashboard, listMembers, saveEntry } from "../src/lib/server/tracker";

const OWNER_ID = "123456789012345800";
const MEMBER_ID = "123456789012345801";
const GUILD_ID = "123456789012345802";
const settings = {
  NODE_ENV: "test", DEMO_MODE: "false", AUTH_SECRET: "profile-tests-only-secret-at-least-32-characters",
  APP_URL: "http://localhost:3000", DISCORD_CLIENT_ID: "profile-tests-only-client",
  DISCORD_CLIENT_SECRET: "profile-tests-only-client-secret", DISCORD_GUILD_ID: GUILD_ID,
  INITIAL_ADMIN_DISCORD_ID: OWNER_ID,
};
const previous = Object.fromEntries([...Object.keys(settings), "DISCORD_ROLE_ID"].map((key) => [key, process.env[key]]));
before(() => { Object.assign(process.env, settings); delete process.env.DISCORD_ROLE_ID; });
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const user = (id = OWNER_ID): DiscordUser => ({ id, username: "discord_handle", global_name: "Global Display", avatar: "global_hash", discriminator: "0" });
const membership = (nick: string | null, profileUser?: DiscordUser): DiscordMembership => ({ roles: [], nick, avatar: "server_hash", ...(profileUser ? { user: profileUser } : {}) });
const fetchMember = (body: unknown) => (async () => Response.json(body)) as typeof fetch;
const failure = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase();
  try { await initializeSchema(db); await work(db); }
  finally { await db.close(); }
}
async function sessionFor(db: Database, id = OWNER_ID) {
  const profileUser = user(id);
  const member = await registerDiscordMember(profileUser, db, membership("Turmoil Knight", profileUser));
  const token = await createSession(member, {
    access_token: "profile-test-access", refresh_token: "profile-test-refresh", expires_in: 3600,
    token_type: "Bearer", scope: "identify guilds.members.read",
  }, db);
  return { member, token };
}
async function recheck(db: Database, token: string, body: unknown) {
  await db.query("UPDATE auth_sessions SET membership_checked_at = NOW() - INTERVAL '6 minutes' WHERE token_hash = $1", [hashToken(token)]);
  return authenticatedMember(token, { db, fetcher: fetchMember(body) });
}

test("server nickname wins, then global display name, then the raw Discord handle", () => {
  assert.equal(discordProfile(user(), membership("  Clan Knight ⚔  ")).displayName, "Clan Knight ⚔");
  assert.equal(discordProfile(user(), membership(null)).displayName, "Global Display");
  assert.equal(discordProfile(user(), membership("   ")).displayName, "Global Display");
  assert.equal(discordProfile({ ...user(), global_name: null }, membership(null)).displayName, "discord_handle");
});

test("guild avatars use the guild CDN path with animated and global/default fallbacks", () => {
  assert.equal(discordProfile(user(), membership("Knight")).avatarUrl, `https://cdn.discordapp.com/guilds/${GUILD_ID}/users/${OWNER_ID}/avatars/server_hash.png?size=128`);
  assert.equal(discordProfile(user(), { avatar: "a_animated" }).avatarUrl, `https://cdn.discordapp.com/guilds/${GUILD_ID}/users/${OWNER_ID}/avatars/a_animated.gif?size=128`);
  assert.equal(discordProfile(user(), { avatar: null }).avatarUrl, avatarUrl(user()));
  const plain = { ...user(), avatar: null };
  const defaultIndex = Number((BigInt(OWNER_ID) >> BigInt(22)) % BigInt(6));
  assert.equal(discordProfile(plain, {}).avatarUrl, `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`);
  assert.equal(avatarUrl({ ...plain, discriminator: "1234" }), "https://cdn.discordapp.com/embed/avatars/4.png");
});

test("membership verification retains validated profile fields and rejects malformed ones", async () => {
  const expected = membership("Turmoil Knight", user());
  assert.deepEqual(await assertGuildMembership("profile-test-access", fetchMember(expected)), expected);
  assert.deepEqual((await assertGuildMembership("profile-test-access", fetchMember({ roles: [] }))).roles, []);
  for (const body of [{ roles: [123] }, { roles: [], nick: 10 }, { roles: [], avatar: {} }, { roles: [], user: { id: OWNER_ID, username: 1 } }]) {
    await assert.rejects(assertGuildMembership("profile-test-access", fetchMember(body)), failure("DISCORD_UNAVAILABLE"));
  }
});

test("login stores the server profile but retains Discord identity and the actual handle", async () => {
  await withDatabase(async (db) => {
    const profileUser = user();
    const member = await registerDiscordMember(profileUser, db, membership("Turmoil Knight", profileUser));
    assert.equal(member.username, "Turmoil Knight");
    assert.equal(member.discordId, OWNER_ID);
    assert.equal(member.role, "ADMIN");
    const [stored] = await db.query("SELECT * FROM app_members WHERE id = $1", [member.id]);
    assert.equal(stored.username, "discord_handle");
    assert.equal(stored.display_name, "Turmoil Knight");
    assert.equal(stored.global_display_name, "Global Display");
    assert.equal(stored.global_avatar_url, avatarUrl(profileUser));
    assert.equal(stored.avatar_url, member.avatarUrl);
    const other = await registerDiscordMember(user(MEMBER_ID), db, membership("ADMIN"));
    assert.equal(other.role, "MEMBER");
  });
});

test("re-login updates a profile without creating a member or changing resources, role, or update time", async () => {
  await withDatabase(async (db) => {
    const original = await registerDiscordMember(user(), db, membership("Old Clan Name"));
    await saveEntry(original, { week: "2026-10-05", resources: { ...EMPTY_RESOURCES, hammers: 73 }, notes: "Keep my inventory" }, db);
    const [before] = await db.query("SELECT * FROM app_members WHERE id = $1", [original.id]);
    const updated = await registerDiscordMember({ ...user(), username: "new_handle" }, db, membership("New Clan Name"));
    const [stored] = await db.query("SELECT * FROM app_members WHERE id = $1", [original.id]);
    assert.equal(updated.id, original.id);
    assert.equal(updated.username, "New Clan Name");
    assert.equal(stored.username, "new_handle");
    assert.equal(stored.role, before.role);
    assert.equal(stored.active, before.active);
    assert.equal(String(stored.last_updated_at), String(before.last_updated_at));
    assert.equal(String(stored.joined_at), String(before.joined_at));
    assert.equal((await db.query("SELECT id FROM app_members")).length, 1);
    const result = await dashboard(updated, "2026-10-05", db);
    assert.equal(result.totals.hammers, 73);
    assert.equal(result.entries[0].notes, "Keep my inventory");
    assert.equal(result.entries[0].updatedBy.username, "New Clan Name");
  });
});

test("membership checks refresh nicknames and server avatars, including profile removals", async () => {
  await withDatabase(async (db) => {
    const { member, token } = await sessionFor(db);
    await saveEntry(member, { week: "2026-10-05", resources: { ...EMPTY_RESOURCES, eggsMythic: 12 }, notes: "Profile sync" }, db);
    const renamed = await recheck(db, token, { ...membership("Renamed Knight", user()), avatar: "new_server_avatar" });
    assert.equal(renamed?.username, "Renamed Knight");
    assert.match(renamed!.avatarUrl!, /new_server_avatar\.png/);
    const refreshed = await authenticatedMember(token, { db, fetcher: (async () => { throw new Error("cached checks must not call Discord"); }) as typeof fetch });
    assert.equal(refreshed?.username, "Renamed Knight");
    const globalUser = { ...user(), username: "renamed_handle", global_name: "Updated Global", avatar: "updated_global" };
    const cleared = await recheck(db, token, { roles: [], nick: null, avatar: null, user: globalUser });
    assert.equal(cleared?.username, "Updated Global");
    assert.equal(cleared?.avatarUrl, avatarUrl(globalUser));
    const rawUser = { ...globalUser, global_name: null, avatar: null };
    const raw = await recheck(db, token, { roles: [], nick: null, avatar: null, user: rawUser });
    assert.equal(raw?.username, "renamed_handle");
    assert.equal(raw?.avatarUrl, avatarUrl(rawUser));
    assert.equal(raw?.id, member.id);
    assert.equal(raw?.role, "ADMIN");
    assert.equal((await dashboard(raw!, "2026-10-05", db)).totals.eggsMythic, 12);
  });
});

test("a membership response without user details preserves the stored global fallbacks", async () => {
  await withDatabase(async (db) => {
    const { token } = await sessionFor(db);
    const cleared = await recheck(db, token, { roles: [], nick: null, avatar: null });
    assert.equal(cleared?.username, "Global Display");
    assert.equal(cleared?.avatarUrl, avatarUrl(user()));
  });
});

test("a mismatched Discord identity cannot register or refresh someone else's profile", async () => {
  await withDatabase(async (db) => {
    await assert.rejects(registerDiscordMember(user(), db, membership("Wrong identity", user(MEMBER_ID))), failure("DISCORD_AUTH_FAILED"));
    assert.equal((await db.query("SELECT id FROM app_members")).length, 0);
    const { member, token } = await sessionFor(db);
    await assert.rejects(recheck(db, token, membership("Wrong identity", user(MEMBER_ID))), failure("DISCORD_AUTH_FAILED"));
    const [stored] = await db.query("SELECT * FROM app_members WHERE id = $1", [member.id]);
    assert.equal(stored.display_name, "Turmoil Knight");
    assert.equal(stored.discord_id, OWNER_ID);
    assert.equal((await db.query("SELECT token_hash FROM auth_sessions WHERE token_hash = $1", [hashToken(token)])).length, 0);
  });
});

test("dashboard sorting and editor attribution show server names throughout current and copied weeks", async () => {
  await withDatabase(async (db) => {
    const owner = await registerDiscordMember({ ...user(), username: "a_handle" }, db, membership("Zeta Officer"));
    const member = await registerDiscordMember({ ...user(MEMBER_ID), username: "z_handle" }, db, membership("Alpha Knight"));
    await saveEntry(owner, { week: "2026-10-05", memberId: member.id, resources: { ...EMPTY_RESOURCES, potions: 91 }, notes: "Admin contribution" }, db);
    const current = await dashboard(owner, "2026-10-05", db);
    assert.deepEqual(current.members.map((row) => row.username), ["Alpha Knight", "Zeta Officer"]);
    assert.equal(current.entries[0].updatedBy.username, "Zeta Officer");
    assert.deepEqual((await listMembers(owner, db)).map((row) => row.username), ["Zeta Officer", "Alpha Knight"]);
    const copied = await copyPreviousEntry(member, { week: "2026-10-12" }, db);
    assert.equal(copied.updatedBy.username, "Alpha Knight");
    assert.equal(copied.resources.potions, 91);
    assert.equal((await dashboard(owner, "2026-10-05", db)).entries[0].updatedBy.username, "Zeta Officer");
  });
});

test("automatic migration upgrades an existing member table without losing identity or entries", async () => {
  const db = await openDatabase();
  const id = randomUUID();
  try {
    await db.query(`CREATE TABLE app_members (
      id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL, avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'MEMBER', active BOOLEAN NOT NULL DEFAULT TRUE,
      last_updated_at TIMESTAMPTZ, joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query("INSERT INTO app_members(id,discord_id,username,role,avatar_url) VALUES ($1,$2,$3,'ADMIN',$4)", [id, OWNER_ID, "legacy_handle", avatarUrl(user())]);
    await initializeSchema(db);
    const [legacy] = await db.query("SELECT * FROM app_members WHERE id = $1", [id]);
    assert.equal(memberFromRow(legacy).username, "legacy_handle");
    assert.equal(legacy.display_name, null);
    await saveEntry(memberFromRow(legacy), { week: "2026-10-05", resources: { ...EMPTY_RESOURCES, hammers: 15 }, notes: "Existing resources" }, db);
    await initializeSchema(db);
    const updated = await registerDiscordMember(user(), db, membership("Migrated Knight"));
    assert.equal(updated.id, id);
    assert.equal(updated.role, "ADMIN");
    assert.equal((await db.query("SELECT id FROM app_members")).length, 1);
    const result = await dashboard(updated, "2026-10-05", db);
    assert.equal(result.totals.hammers, 15);
    assert.equal(result.entries[0].notes, "Existing resources");
  } finally { await db.close(); }
});
