import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { GET as sessionResponse } from "../src/app/api/session/route";
import {
  authenticatedMember,
  createSession,
  registerDiscordMember,
  revokeSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../src/lib/server/auth";
import { hashToken } from "../src/lib/server/crypto";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import type { Member } from "../src/lib/types";

const REMEMBERED_MILLISECONDS = 180 * 24 * 60 * 60 * 1000;
const settings = {
  NODE_ENV: "test",
  DEMO_MODE: "false",
  AUTH_SECRET: "remembered-login-tests-only-secret-at-least-32-characters",
  APP_URL: "http://localhost:3000",
  DISCORD_CLIENT_ID: "remembered-login-tests-client",
  DISCORD_CLIENT_SECRET: "remembered-login-tests-client-secret",
  DISCORD_GUILD_ID: "123456789012345900",
};
const previous = Object.fromEntries(
  [...Object.keys(settings), "DISCORD_ROLE_ID", "INITIAL_ADMIN_DISCORD_ID"].map((key) => [key, process.env[key]]),
);
const previousDatabase = globalThis.turmoilDatabase;
const originalFetch = globalThis.fetch;
let db: Database;
let member: Member;

before(async () => {
  Object.assign(process.env, settings);
  delete process.env.DISCORD_ROLE_ID;
  delete process.env.INITIAL_ADMIN_DISCORD_ID;
  db = await openDatabase();
  await initializeSchema(db);
  globalThis.turmoilDatabase = Promise.resolve(db);
  member = await registerDiscordMember({
    id: "123456789012345901", username: "Remembered member", avatar: null, discriminator: "0",
  }, db);
});

after(async () => {
  globalThis.fetch = originalFetch;
  globalThis.turmoilDatabase = previousDatabase;
  await db.close();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function newSession(target = member) {
  return createSession(target, {
    access_token: "remembered-access", refresh_token: "remembered-refresh",
    expires_in: 3600, token_type: "Bearer", scope: "identify guilds.members.read",
  }, db);
}

async function storedSession(token: string) {
  const [session] = await db.query("SELECT * FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
  return session;
}

function assertSixMonths(expiresAt: unknown, before: number, after: number) {
  const expiry = expiresAt instanceof Date ? expiresAt.getTime() : new Date(String(expiresAt)).getTime();
  assert.ok(expiry >= before + REMEMBERED_MILLISECONDS);
  assert.ok(expiry <= after + REMEMBERED_MILLISECONDS);
}

function request(token?: string) {
  return new NextRequest("http://localhost:3000/api/session", {
    headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {},
  });
}

async function requireRecheck(token: string) {
  await db.query(
    "UPDATE auth_sessions SET expires_at = NOW() + INTERVAL '1 day', membership_checked_at = NOW() - INTERVAL '25 hours' WHERE token_hash = $1",
    [hashToken(token)],
  );
}

test("new remembered browser sessions last 180 days", async () => {
  const before = Date.now();
  const token = await newSession();
  const after = Date.now();
  assertSixMonths((await storedSession(token)).expires_at, before, after);
});

test("a still-valid old seven-day session upgrades on return without an extra Discord check", async () => {
  const token = await newSession();
  await db.query("UPDATE auth_sessions SET expires_at = NOW() + INTERVAL '1 hour' WHERE token_hash = $1", [hashToken(token)]);
  const before = Date.now();
  const result = await authenticatedMember(token, {
    db,
    fetcher: (async () => { throw new Error("A recently validated membership should be cached"); }) as typeof fetch,
  });
  const after = Date.now();
  assert.equal(result?.id, member.id);
  assertSixMonths((await storedSession(token)).expires_at, before, after);
});

test("stale membership must pass Discord verification before renewing the session", async () => {
  const token = await newSession();
  await requireRecheck(token);
  let checks = 0;
  const before = Date.now();
  const result = await authenticatedMember(token, {
    db,
    fetcher: (async (url) => {
      assert.match(String(url), /\/users\/@me\/guilds\/[^/]+\/member$/);
      checks++;
      return Response.json({ roles: [] });
    }) as typeof fetch,
  });
  const after = Date.now();
  assert.equal(result?.id, member.id);
  assert.equal(checks, 1);
  const session = await storedSession(token);
  assertSixMonths(session.expires_at, before, after);
  assert.ok(Date.now() - new Date(String(session.membership_checked_at)).getTime() < 5000);
});

test("the session endpoint refreshes the same opaque HTTP-only browser cookie", async () => {
  const token = await newSession();
  const response = await sessionResponse(request(token));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.id, member.id);
  assert.deepEqual(Object.keys(body).sort(), ["configured", "demo", "user"]);
  const cookie = response.cookies.get(SESSION_COOKIE);
  assert.equal(cookie?.value, token);
  assert.equal(cookie?.maxAge, REMEMBERED_MILLISECONDS / 1000);
  assert.equal(cookie?.httpOnly, true);
  assert.equal(cookie?.sameSite, "lax");
  assert.equal(cookie?.path, "/");
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  Object.assign(process.env, { NODE_ENV: "production" });
  try { assert.equal(sessionCookieOptions().secure, true); }
  finally { Object.assign(process.env, { NODE_ENV: "test" }); }
});

test("missing, unknown, expired and revoked sessions never receive a renewed cookie", async () => {
  const expired = await newSession();
  const revoked = await newSession();
  await db.query("UPDATE auth_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1", [hashToken(expired)]);
  const expiredAt = String((await storedSession(expired)).expires_at);
  await revokeSession(revoked);
  for (const token of [undefined, "unknown-browser-session", expired, revoked]) {
    const response = await sessionResponse(request(token));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user, null);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
  const stored = await storedSession(expired);
  assert.equal(String(stored.expires_at), expiredAt);
  assert.equal(await storedSession(revoked), undefined);
});

test("a deactivated account cannot renew even a recently checked browser session", async () => {
  const inactive = await registerDiscordMember({
    id: "123456789012345902", username: "Inactive member", avatar: null, discriminator: "0",
  }, db);
  const token = await newSession(inactive);
  const expiresAt = String((await storedSession(token)).expires_at);
  await db.query("UPDATE app_members SET active = FALSE WHERE id = $1", [inactive.id]);
  const response = await sessionResponse(request(token));
  assert.equal((await response.json()).user, null);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(String((await storedSession(token)).expires_at), expiresAt);
});

test("membership removal revokes a remembered browser instead of extending it", async () => {
  const token = await newSession();
  await requireRecheck(token);
  globalThis.fetch = (async () => Response.json({}, { status: 404 })) as typeof fetch;
  try {
    const response = await sessionResponse(request(token));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "GUILD_REQUIRED");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(await storedSession(token), undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("a missing required role revokes a remembered browser", async () => {
  const token = await newSession();
  await requireRecheck(token);
  process.env.DISCORD_ROLE_ID = "required-role";
  globalThis.fetch = (async () => Response.json({ roles: [] })) as typeof fetch;
  try {
    const response = await sessionResponse(request(token));
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "ROLE_REQUIRED");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(await storedSession(token), undefined);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DISCORD_ROLE_ID;
  }
});

test("a Discord outage keeps the session without renewal; a successful retry renews it", async () => {
  const token = await newSession();
  await requireRecheck(token);
  const original = await storedSession(token);
  globalThis.fetch = (async () => Response.json({}, { status: 503 })) as typeof fetch;
  try {
    const unavailable = await sessionResponse(request(token));
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).code, "DISCORD_UNAVAILABLE");
    assert.equal(unavailable.headers.get("Set-Cookie"), null);
    const retained = await storedSession(token);
    assert.equal(String(retained.expires_at), String(original.expires_at));
    assert.equal(String(retained.membership_checked_at), String(original.membership_checked_at));
    globalThis.fetch = (async () => Response.json({ roles: [] })) as typeof fetch;
    const before = Date.now();
    const recovered = await sessionResponse(request(token));
    const after = Date.now();
    assert.equal((await recovered.json()).user.id, member.id);
    assert.equal(recovered.cookies.get(SESSION_COOKIE)?.value, token);
    assertSixMonths((await storedSession(token)).expires_at, before, after);
  } finally { globalThis.fetch = originalFetch; }
});

test("a brief Discord outage keeps a recently confirmed member signed in", async () => {
  const token = await newSession();
  await db.query(
    "UPDATE auth_sessions SET membership_checked_at = NOW() - INTERVAL '2 hours' WHERE token_hash = $1",
    [hashToken(token)],
  );
  const result = await authenticatedMember(token, {
    db,
    fetcher: (async () => Response.json({}, { status: 503 })) as typeof fetch,
  });
  assert.equal(result?.id, member.id);
});

test("a recently checked session is answered without contacting Discord", async () => {
  const token = await newSession();
  const result = await authenticatedMember(token, {
    db,
    fetcher: (async () => { throw new Error("Discord should not be called"); }) as typeof fetch,
  });
  assert.equal(result?.id, member.id);
});

test("a rejected Discord refresh token revokes the browser session", async () => {
  const token = await newSession();
  await requireRecheck(token);
  await db.query("UPDATE auth_sessions SET oauth_expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1", [hashToken(token)]);
  globalThis.fetch = (async (url) => {
    assert.match(String(url), /\/oauth2\/token$/);
    return Response.json({}, { status: 401 });
  }) as typeof fetch;
  try {
    const response = await sessionResponse(request(token));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "DISCORD_AUTH_FAILED");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(await storedSession(token), undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("Discord re-login preserves a profile baseline and records only visible profile changes", async () => {
  const user = { id: "123456789012345903", username: "profile-handle", avatar: null, discriminator: "0" };
  const first = await registerDiscordMember(user, db, { roles: [], nick: "Original clan name" });
  const events = () => db.query("SELECT * FROM member_status_events WHERE member_id = $1 ORDER BY changed_at,id", [first.id]);
  let history = await events();
  assert.equal(history.length, 1);
  assert.equal(history[0].username, "Original clan name");
  const initialTime = history[0].changed_at;
  assert.equal(initialTime instanceof Date ? initialTime.toISOString() : new Date(String(initialTime)).toISOString(), first.joinedAt);
  await registerDiscordMember(user, db, { roles: [], nick: "Original clan name" });
  assert.equal((await events()).length, 1);

  // Simulate an account created before status events were recorded.
  await db.query("DELETE FROM member_status_events WHERE member_id = $1", [first.id]);
  await registerDiscordMember(user, db, { roles: [], nick: "Renamed clan member", avatar: "new-avatar" });
  history = await events();
  assert.equal(history.length, 2);
  assert.equal(history[0].username, "Original clan name");
  assert.equal(history[1].username, "Renamed clan member");
  assert.match(String(history[1].avatar_url), /new-avatar\.png/);
  assert.equal(history[1].role, first.role);
  assert.equal(history[1].active, true);

  await registerDiscordMember({ ...user, username: "new-handle" }, db, { roles: [], nick: "Renamed clan member", avatar: "new-avatar" });
  assert.equal((await events()).length, 2);
});

test("a successful membership profile refresh appends history once and failed checks append nothing", async () => {
  const user = { id: "123456789012345904", username: "membership-handle", avatar: null, discriminator: "0" };
  const profileMember = await registerDiscordMember(user, db, { roles: [], nick: "Previous name" });
  const token = await newSession(profileMember);
  const events = () => db.query("SELECT * FROM member_status_events WHERE member_id = $1 ORDER BY changed_at,id", [profileMember.id]);
  await requireRecheck(token);
  const fetcher = (async () => Response.json({ roles: [], nick: "Refreshed name", avatar: "refreshed-avatar" })) as typeof fetch;
  assert.equal((await authenticatedMember(token, { db, fetcher }))?.username, "Refreshed name");
  const history = await events();
  assert.deepEqual(history.map((row) => row.username), ["Previous name", "Refreshed name"]);
  assert.match(String(history[1].avatar_url), /refreshed-avatar\.png/);
  await requireRecheck(token);
  await authenticatedMember(token, { db, fetcher });
  assert.equal((await events()).length, 2);
  await requireRecheck(token);
  await assert.rejects(authenticatedMember(token, {
    db, fetcher: (async () => Response.json({}, { status: 503 })) as typeof fetch,
  }));
  assert.equal((await events()).length, 2);
});
