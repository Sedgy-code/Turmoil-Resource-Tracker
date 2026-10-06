import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { randomUUID } from "node:crypto";
import { currentWeek, EMPTY_RESOURCES, shiftWeek } from "../src/lib/resources";
import {
  weekSchema,
  resourceSchema,
  saveResourcesSchema,
} from "../src/lib/server/validation";
import { assertSameOrigin, isDemo } from "../src/lib/server/config";
import { ApiError } from "../src/lib/server/errors";
import {
  decrypt,
  encrypt,
  hashToken,
  timingSafeMatch,
} from "../src/lib/server/crypto";
import {
  assertGuildMembership,
  type DiscordUser,
} from "../src/lib/server/discord";
import {
  openDatabase,
  initializeSchema,
  type Database,
} from "../src/lib/server/db";
import {
  authenticatedMember,
  createSession,
  registerDiscordMember,
} from "../src/lib/server/auth";
import {
  dashboard,
  saveEntry,
  copyPreviousEntry,
  updateMember,
  listMembers,
  listWeeks,
} from "../src/lib/server/tracker";
import type { Member } from "../src/lib/types";

const savedEnv = Object.fromEntries(
  [
    "NODE_ENV",
    "DEMO_MODE",
    "AUTH_SECRET",
    "APP_URL",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_GUILD_ID",
    "DISCORD_ROLE_ID",
    "INITIAL_ADMIN_DISCORD_ID",
  ].map((key) => [key, process.env[key]]),
);
let db: Database;
let admin: Member;
let member: Member;
const discordUser = (id: string, username: string): DiscordUser => ({
  id,
  username,
  global_name: `Display ${username}`,
  avatar: null,
  discriminator: "0",
});
const apiFailure = (code: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code;
const responseFetcher = (status: number, body: unknown = {}) =>
  (async () => Response.json(body, { status })) as typeof fetch;

before(async () => {
  Object.assign(process.env, { NODE_ENV: "test" });
  delete process.env.DEMO_MODE;
  delete process.env.INITIAL_ADMIN_DISCORD_ID;
  delete process.env.DISCORD_ROLE_ID;
  process.env.AUTH_SECRET = "tests-only-secret-at-least-thirty-two-characters";
  process.env.APP_URL = "http://localhost:3000";
  process.env.DISCORD_CLIENT_ID = "123456789012345678";
  process.env.DISCORD_CLIENT_SECRET = "tests-only-client-secret";
  process.env.DISCORD_GUILD_ID = "123456789012345679";
  db = await openDatabase();
  await initializeSchema(db);
  admin = await registerDiscordMember(
    discordUser("123456789012345680", "Admin"),
    db,
  );
  member = await registerDiscordMember(
    discordUser("123456789012345681", "Member"),
    db,
  );
});
after(async () => {
  await db.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Resource and week validation", () => {
  test("missing numeric resources default to zero", () => {
    assert.deepEqual(resourceSchema.parse({}), EMPTY_RESOURCES);
    assert.equal(
      saveResourcesSchema.parse({ week: "2026-10-05", resources: {} }).notes,
      "",
    );
  });
  test("rejects negative, fractional, nonfinite, string and unknown resources", () => {
    for (const value of [-1, 1.5, NaN, Infinity, "9", 1_000_000_001])
      assert.equal(
        resourceSchema.safeParse({ skillTickets: value }).success,
        false,
      );
    assert.equal(
      resourceSchema.safeParse({ skillTickets: 5, unknown: 1 }).success,
      false,
    );
  });
  test("only valid Monday ISO dates are accepted", () => {
    assert.equal(weekSchema.safeParse("2026-10-05").success, true);
    for (const week of [
      "2026-10-06",
      "2026-02-30",
      "invalid",
      "2026-1-5",
      "1999-12-27",
    ])
      assert.equal(weekSchema.safeParse(week).success, false);
  });
  test("UTC week calculation handles Sundays and year boundaries", () => {
    assert.equal(currentWeek(new Date("2026-10-11T23:59:59Z")), "2026-10-05");
    assert.equal(currentWeek(new Date("2027-01-01T00:01:00Z")), "2026-12-28");
    assert.equal(shiftWeek("2027-01-04", -1), "2026-12-28");
  });
});

describe("Authentication boundaries", () => {
  test("encrypted data rejects tampering and state matching is exact", () => {
    const sealed = encrypt("private OAuth token");
    assert.equal(decrypt(sealed), "private OAuth token");
    const bytes = Buffer.from(sealed, "base64url");
    bytes[30] ^= 1;
    assert.throws(() => decrypt(bytes.toString("base64url")));
    assert.equal(timingSafeMatch("correct", "correct"), true);
    assert.equal(timingSafeMatch("correct", "incorrect"), false);
  });
  test("unsafe or missing request origins are denied", () => {
    assertSameOrigin(
      new Request("http://localhost:3000/api/resources", {
        headers: { origin: "http://localhost:3000" },
      }),
    );
    assert.throws(
      () =>
        assertSameOrigin(new Request("http://localhost:3000/api/resources")),
      apiFailure("INVALID_ORIGIN"),
    );
    assert.throws(
      () =>
        assertSameOrigin(
          new Request("http://localhost:3000/api/resources", {
            headers: { origin: "https://evil.example" },
          }),
        ),
      apiFailure("INVALID_ORIGIN"),
    );
  });
  test("demo mode is impossible in production", () => {
    process.env.DEMO_MODE = "true";
    Object.assign(process.env, { NODE_ENV: "production" });
    try {
      assert.throws(() => isDemo(), apiFailure("INVALID_CONFIGURATION"));
    } finally {
      delete process.env.DEMO_MODE;
      Object.assign(process.env, { NODE_ENV: "test" });
    }
  });
  test("missing guild membership and required role fail closed", async () => {
    await assert.rejects(
      assertGuildMembership("token", responseFetcher(404)),
      apiFailure("GUILD_REQUIRED"),
    );
    process.env.DISCORD_ROLE_ID = "required-role";
    try {
      await assert.rejects(
        assertGuildMembership("token", responseFetcher(200, { roles: [] })),
        apiFailure("ROLE_REQUIRED"),
      );
      await assertGuildMembership(
        "token",
        responseFetcher(200, { roles: ["required-role"] }),
      );
    } finally {
      delete process.env.DISCORD_ROLE_ID;
    }
  });
  test("Discord outages are service failures rather than permission grants", async () => {
    await assert.rejects(
      assertGuildMembership("token", responseFetcher(429)),
      apiFailure("DISCORD_UNAVAILABLE"),
    );
    await assert.rejects(
      assertGuildMembership("token", (async () => {
        throw new TypeError("network unavailable");
      }) as typeof fetch),
      apiFailure("DISCORD_UNAVAILABLE"),
    );
  });
  test("unknown and expired sessions cannot authenticate", async () => {
    assert.equal(await authenticatedMember(undefined, { db }), null);
    assert.equal(await authenticatedMember("unknown-session", { db }), null);
    const token = await createSession(
      member,
      {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "identify guilds.members.read",
      },
      db,
    );
    await db.query(
      "UPDATE auth_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1",
      [hashToken(token)],
    );
    assert.equal(await authenticatedMember(token, { db }), null);
  });
  test("sessions contain hashes only and membership removal revokes access", async () => {
    const token = await createSession(
      member,
      {
        access_token: "sensitive-access",
        refresh_token: "sensitive-refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "identify guilds.members.read",
      },
      db,
    );
    const rows = await db.query(
      "SELECT * FROM auth_sessions WHERE token_hash = $1",
      [hashToken(token)],
    );
    assert.notEqual(rows[0].token_hash, token);
    assert.notEqual(rows[0].encrypted_access_token, "sensitive-access");
    assert.equal((await authenticatedMember(token, { db }))?.id, member.id);
    await db.query(
      "UPDATE auth_sessions SET membership_checked_at = NOW() - INTERVAL '6 minutes' WHERE token_hash = $1",
      [hashToken(token)],
    );
    await assert.rejects(
      authenticatedMember(token, { db, fetcher: responseFetcher(404) }),
      apiFailure("GUILD_REQUIRED"),
    );
    assert.equal(
      (
        await db.query(
          "SELECT token_hash FROM auth_sessions WHERE token_hash = $1",
          [hashToken(token)],
        )
      ).length,
      0,
    );
  });
  test("membership verification retries preserve sessions during transient failures", async () => {
    const token = await createSession(
      member,
      {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "identify guilds.members.read",
      },
      db,
    );
    await db.query(
      "UPDATE auth_sessions SET membership_checked_at = NOW() - INTERVAL '6 minutes' WHERE token_hash = $1",
      [hashToken(token)],
    );
    await assert.rejects(
      authenticatedMember(token, { db, fetcher: responseFetcher(503) }),
      apiFailure("DISCORD_UNAVAILABLE"),
    );
    assert.equal(
      (
        await db.query(
          "SELECT token_hash FROM auth_sessions WHERE token_hash = $1",
          [hashToken(token)],
        )
      ).length,
      1,
    );
    assert.equal(
      (
        await authenticatedMember(token, {
          db,
          fetcher: responseFetcher(200, { roles: [] }),
        })
      )?.id,
      member.id,
    );
  });
  test("concurrent requests refresh one OAuth token once and use the new membership check", async () => {
    const token = await createSession(
      member,
      {
        access_token: "old-access",
        refresh_token: "old-refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "identify guilds.members.read",
      },
      db,
    );
    await db.query(
      "UPDATE auth_sessions SET membership_checked_at = NOW() - INTERVAL '6 minutes', oauth_expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1",
      [hashToken(token)],
    );
    let refreshes = 0;
    let checks = 0;
    const fetcher = (async (url, options) => {
      if (String(url).endsWith("/oauth2/token")) {
        refreshes++;
        assert.equal(
          (options?.body as URLSearchParams).get("refresh_token"),
          "old-refresh",
        );
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "identify guilds.members.read",
        });
      }
      checks++;
      assert.equal(
        (options?.headers as Record<string, string>).Authorization,
        "Bearer new-access",
      );
      return Response.json({ roles: [] });
    }) as typeof fetch;
    const results = await Promise.all([
      authenticatedMember(token, { db, fetcher }),
      authenticatedMember(token, { db, fetcher }),
    ]);
    assert.equal(
      results.every((result) => result?.id === member.id),
      true,
    );
    assert.equal(refreshes, 1);
    assert.equal(checks, 1);
  });
  test("a rotated refresh token remains saved when the following guild check is temporarily unavailable", async () => {
    const token = await createSession(
      member,
      {
        access_token: "old-access",
        refresh_token: "old-refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "identify guilds.members.read",
      },
      db,
    );
    await db.query(
      "UPDATE auth_sessions SET membership_checked_at = NOW() - INTERVAL '6 minutes', oauth_expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1",
      [hashToken(token)],
    );
    const fetcher = (async (url) =>
      String(url).endsWith("/oauth2/token")
        ? Response.json({
            access_token: "rotated-access",
            refresh_token: "rotated-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "identify guilds.members.read",
          })
        : Response.json({}, { status: 503 })) as typeof fetch;
    await assert.rejects(
      authenticatedMember(token, { db, fetcher }),
      apiFailure("DISCORD_UNAVAILABLE"),
    );
    const rows = await db.query(
      "SELECT encrypted_refresh_token FROM auth_sessions WHERE token_hash = $1",
      [hashToken(token)],
    );
    assert.equal(
      decrypt(String(rows[0].encrypted_refresh_token)),
      "rotated-refresh",
    );
    assert.equal(
      (
        await authenticatedMember(token, {
          db,
          fetcher: responseFetcher(200, { roles: [] }),
        })
      )?.id,
      member.id,
    );
  });
});

describe("Tracker permissions and persistence", () => {
  test("bootstrap chooses one admin and retains handles while showing display names", async () => {
    assert.equal(admin.role, "ADMIN");
    assert.equal(member.role, "MEMBER");
    assert.equal(admin.username, "Display Admin");
    const rows = await db.query("SELECT username FROM app_members WHERE id = $1", [admin.id]);
    assert.equal(rows[0].username, "Admin");
  });
  test("week history includes only persisted entries rather than selectable empty weeks", async () => {
    assert.deepEqual(await listWeeks(db), []);
    const result = await dashboard(admin, "2026-10-05", db);
    assert.deepEqual(result.weeks, []);
  });
  test("members can save only their own entries; admins can edit another member", async () => {
    const values = {
      ...EMPTY_RESOURCES,
      hammers: 40,
      skillTickets: 100,
      eggsPetsTotal: 83,
    };
    await assert.rejects(
      saveEntry(
        member,
        {
          week: "2026-10-05",
          memberId: admin.id,
          resources: values,
          notes: "",
        },
        db,
      ),
      apiFailure("FORBIDDEN"),
    );
    const entry = await saveEntry(
      member,
      { week: "2026-10-05", resources: values, notes: "A saved note" },
      db,
    );
    assert.equal(entry.memberId, member.id);
    assert.equal(entry.updatedBy.id, member.id);
    const edited = await saveEntry(
      admin,
      {
        week: "2026-10-05",
        memberId: member.id,
        resources: { ...values, hammers: 42, eggsPetsTotal: 84 },
        notes: "Admin edit",
      },
      db,
    );
    assert.equal(edited.id, entry.id);
    assert.equal(edited.updatedBy.id, admin.id);
    const result = await dashboard(admin, "2026-10-05", db);
    assert.equal(result.totals.hammers, 42);
    assert.equal(result.totals.eggsPetsTotal, 84);
    assert.equal(result.stats.submittedMembers, 1);
    assert.deepEqual(result.weeks, ["2026-10-05"]);
  });
  test("copy uses the immediately previous week and preserves history", async () => {
    const entry = await copyPreviousEntry(member, { week: "2026-10-12" }, db);
    assert.equal(entry.resources.hammers, 42);
    assert.equal(entry.resources.eggsPetsTotal, 84);
    assert.equal(entry.notes, "Admin edit");
    assert.equal((await dashboard(admin, "2026-10-05", db)).totals.hammers, 42);
    assert.equal((await dashboard(admin, "2026-10-05", db)).totals.eggsPetsTotal, 84);
    await assert.rejects(
      copyPreviousEntry(member, { week: "2026-09-28" }, db),
      apiFailure("PREVIOUS_WEEK_EMPTY"),
    );
  });
  test("nonadmins cannot manage members and the final admin cannot be removed", async () => {
    await assert.rejects(listMembers(member, db), apiFailure("ADMIN_REQUIRED"));
    await assert.rejects(
      updateMember(member, admin.id, { role: "MEMBER" }, db),
      apiFailure("ADMIN_REQUIRED"),
    );
    await assert.rejects(
      updateMember(admin, admin.id, { role: "MEMBER" }, db),
      apiFailure("LAST_ADMIN"),
    );
    await assert.rejects(
      updateMember(admin, admin.id, { active: false }, db),
      apiFailure("LAST_ADMIN"),
    );
  });
  test("permission changes are re-read inside writes rather than trusting stale roles", async () => {
    const promoted = await updateMember(
      admin,
      member.id,
      { role: "ADMIN" },
      db,
    );
    assert.equal(promoted.role, "ADMIN");
    const demoted = await updateMember(
      promoted,
      admin.id,
      { role: "MEMBER" },
      db,
    );
    assert.equal(demoted.role, "MEMBER");
    await assert.rejects(
      updateMember(admin, member.id, { active: false }, db),
      apiFailure("ADMIN_REQUIRED"),
    );
    admin = await updateMember(promoted, admin.id, { role: "ADMIN" }, db);
    member = await updateMember(admin, member.id, { role: "MEMBER" }, db);
  });
  test("deactivation revokes sessions, blocks stale writes and retains historical records", async () => {
    const token = await createSession(
      member,
      {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "identify guilds.members.read",
      },
      db,
    );
    await updateMember(admin, member.id, { active: false }, db);
    assert.equal(await authenticatedMember(token, { db }), null);
    await assert.rejects(
      saveEntry(
        member,
        { week: "2026-10-05", resources: EMPTY_RESOURCES, notes: "" },
        db,
      ),
      apiFailure("ACCOUNT_INACTIVE"),
    );
    assert.equal((await dashboard(admin, "2026-10-05", db)).totals.hammers, 0);
    assert.equal((await dashboard(admin, "2026-10-05", db)).totals.eggsPetsTotal, 0);
    assert.equal(
      (
        await db.query("SELECT id FROM resource_entries WHERE member_id = $1", [
          member.id,
        ])
      ).length,
      2,
    );
    member = await updateMember(admin, member.id, { active: true }, db);
  });
  test("designated admin is reserved when supplied and bootstrap works concurrently", async () => {
    const isolated = await openDatabase();
    await initializeSchema(isolated);
    process.env.INITIAL_ADMIN_DISCORD_ID = "123456789012345699";
    try {
      const ordinary = await registerDiscordMember(
        discordUser("123456789012345698", "Ordinary"),
        isolated,
      );
      assert.equal(ordinary.role, "MEMBER");
      const designated = await registerDiscordMember(
        discordUser("123456789012345699", "Designated"),
        isolated,
      );
      assert.equal(designated.role, "ADMIN");
    } finally {
      delete process.env.INITIAL_ADMIN_DISCORD_ID;
      await isolated.close();
    }
    const concurrent = await openDatabase();
    await initializeSchema(concurrent);
    try {
      const users = await Promise.all(
        ["123456789012345700", "123456789012345701"].map((id) =>
          registerDiscordMember(discordUser(id, randomUUID()), concurrent),
        ),
      );
      assert.equal(users.filter((user) => user.role === "ADMIN").length, 1);
    } finally {
      await concurrent.close();
    }
  });
  test("simultaneous demotions leave exactly one active administrator", async () => {
    const isolated = await openDatabase();
    await initializeSchema(isolated);
    try {
      const first = await registerDiscordMember(
        discordUser("123456789012345710", "First"),
        isolated,
      );
      const secondMember = await registerDiscordMember(
        discordUser("123456789012345711", "Second"),
        isolated,
      );
      const second = await updateMember(
        first,
        secondMember.id,
        { role: "ADMIN" },
        isolated,
      );
      const results = await Promise.allSettled([
        updateMember(first, first.id, { role: "MEMBER" }, isolated),
        updateMember(second, second.id, { role: "MEMBER" }, isolated),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        (
          await isolated.query(
            "SELECT id FROM app_members WHERE role = 'ADMIN' AND active = TRUE",
          )
        ).length,
        1,
      );
    } finally {
      await isolated.close();
    }
  });
});
