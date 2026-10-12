import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DEW_ITEMS } from "../src/lib/dew";
import { CHANCE_PLANNING_DETAILS, currentWeek, EMPTY_RESOURCES, shiftWeek } from "../src/lib/resources";
import { authenticatedMember, createSession, SESSION_SECONDS } from "../src/lib/server/auth";
import { bankHistory, captureSnapshot, historicalBankDashboard, liveDashboard, saveBank } from "../src/lib/server/banks";
import { decrypt, hashToken } from "../src/lib/server/crypto";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import { confirmSnipeAttendance, createSnipe, equipDewItem, getDew, listSnipes, purchaseDewItem, respondToSnipe, updateSnipe } from "../src/lib/server/planning";
import { listWeeks, updateMember } from "../src/lib/server/tracker";

const failure = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;

test("PostgreSQL preserves legacy data, live banks, snapshots, planning, rewards, and remembered sessions", {
  skip: !process.env.TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const environmentNames = ["NODE_ENV", "DEMO_MODE", "AUTH_SECRET", "APP_URL", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_GUILD_ID", "DISCORD_ROLE_ID"];
  const previousEnvironment = Object.fromEntries(environmentNames.map((key) => [key, process.env[key]]));
  const schema = `turmoil_test_${randomUUID().replaceAll("-", "")}`;
  assert.match(schema, /^turmoil_test_[a-f0-9]+$/);
  const control = await openDatabase({ url: process.env.TEST_DATABASE_URL! });
  let db: Database | undefined;
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    const isolatedUrl = new URL(process.env.TEST_DATABASE_URL!);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    db = await openDatabase({ url: isolatedUrl.toString() });
    assert.equal(db.dialect, "postgres");
    assert.equal((await db.query("SELECT current_schema() AS schema"))[0].schema, schema);
    Object.assign(process.env, {
      NODE_ENV: "test",
      AUTH_SECRET: "postgres-integration-test-secret-32-characters-minimum",
      APP_URL: "http://localhost:3000",
      DISCORD_CLIENT_ID: "123456789012345678",
      DISCORD_CLIENT_SECRET: "test-only-client-secret",
      DISCORD_GUILD_ID: "123456789012345679",
    });
    delete process.env.DEMO_MODE;
    delete process.env.DISCORD_ROLE_ID;

    // Represent an older deployment before display profiles, costs, planning,
    // persistent banks, snapshots, snipes, and Dew existed.
    await db.query(`CREATE TABLE app_members (
      id TEXT PRIMARY KEY,discord_id TEXT NOT NULL UNIQUE,username TEXT NOT NULL,
      avatar_url TEXT,role TEXT NOT NULL DEFAULT 'MEMBER',active BOOLEAN NOT NULL DEFAULT TRUE,
      last_updated_at TIMESTAMPTZ,joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE resource_entries (
      id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES app_members(id),week_start DATE NOT NULL,
      resources JSONB NOT NULL,notes TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT NOT NULL REFERENCES app_members(id),UNIQUE(member_id,week_start)
    )`);
    const week = currentWeek();
    const oldWeek = shiftWeek(week, -3);
    const latestWeek = shiftWeek(week, -2);
    const leaderId = randomUUID();
    const memberId = randomUUID();
    const joinedAt = `${shiftWeek(week, -4)}T00:00:00Z`;
    await db.query(`INSERT INTO app_members (id,discord_id,username,role,joined_at)
      VALUES ($1,'123456789012345680','Leader','ADMIN',$3),($2,'123456789012345681','Original member','MEMBER',$3)`,
    [leaderId, memberId, joinedAt]);
    const oldEntryId = randomUUID();
    const latestEntryId = randomUUID();
    const latestUpdatedAt = `${latestWeek}T12:00:00Z`;
    await db.query(`INSERT INTO resource_entries (id,member_id,week_start,resources,notes,updated_at,updated_by)
      VALUES ($1,$2,$3,$4::jsonb,'Older submission',$5,$2),($6,$2,$7,$8::jsonb,'Latest legacy submission',$9,$2)`,
    [oldEntryId, memberId, oldWeek, JSON.stringify({ skillTickets: 100, hammers: 6, eggsCommon: 2 }), `${oldWeek}T12:00:00Z`,
      latestEntryId, latestWeek, JSON.stringify({ skillTickets: 200, hammers: 12, eggsRare: 2, petsUltimate: 3, potions: 99 }), latestUpdatedAt]);
    // Different migration baselines: the leader has a current-week row while
    // the member's latest bank remains older. Both original old rows must survive.
    await db.query(`INSERT INTO resource_entries (id,member_id,week_start,resources,notes,updated_at,updated_by)
      VALUES ($1,$2,$3,'{"hammers":7}'::jsonb,'Leader prior submission',$4,$2),
             ($5,$2,$6,'{"hammers":70}'::jsonb,'Leader current submission',$7,$2)`,
    [randomUUID(), leaderId, latestWeek, latestUpdatedAt, randomUUID(), week, new Date().toISOString()]);
    await db.query("UPDATE app_members SET last_updated_at=$2 WHERE id=$1", [memberId, latestUpdatedAt]);

    await initializeSchema(db);
    const initialHistoryState = (await db.query("SELECT started_at FROM bank_history_state WHERE id='live-banks'"))[0];
    await initializeSchema(db);
    assert.deepEqual((await db.query("SELECT started_at FROM bank_history_state WHERE id='live-banks'"))[0], initialHistoryState);
    assert.equal((await db.query("SELECT id FROM resource_entries")).length, 4);
    assert.equal((await db.query("SELECT member_id FROM member_banks")).length, 2);
    assert.equal((await db.query("SELECT id FROM bank_versions")).length, 2);
    assert.equal((await db.query("SELECT id FROM member_status_events")).length, 2);
    const retained = (await db.query("SELECT * FROM resource_entries WHERE id=$1", [latestEntryId]))[0];
    assert.equal(retained.week_start, latestWeek);
    assert.equal(typeof retained.week_start, "string");
    assert.equal((retained.resources as { potions: number }).potions, 99);
    assert.equal("eggshellsTotal" in (retained.resources as object), false);
    assert.deepEqual(await listWeeks(db), [week, latestWeek, oldWeek]);
    const [leaderRow, memberRow] = await Promise.all([
      db.query("SELECT * FROM app_members WHERE id=$1", [leaderId]),
      db.query("SELECT * FROM app_members WHERE id=$1", [memberId]),
    ]);
    const leader = memberFromRow(leaderRow[0]);
    const member = memberFromRow(memberRow[0]);
    const migratedLive = await liveDashboard(leader, db);
    assert.equal(migratedLive.totals.hammers, 82);
    assert.equal(migratedLive.totals.eggsPetsTotal, 5);
    assert.equal(migratedLive.totals.eggshellsTotal, 0);
    assert.equal(migratedLive.summons.missingSkillCosts, 1);
    assert.deepEqual(migratedLive.entries.find((entry) => entry.memberId === memberId)?.summoningCosts, { fiveSkills: 0, mount: 0 });
    const initialHistory = await bankHistory(leader, db);
    const oldSnapshot = initialHistory.snapshots.find((snapshot) => snapshot.week === oldWeek);
    assert.equal(oldSnapshot?.totals.hammers, 6);
    assert.equal(oldSnapshot?.entries[0].notes, "Older submission");
    assert.equal(oldSnapshot?.totals.eggshellsTotal, 0);
    const completeLegacySnapshot = initialHistory.snapshots.find((snapshot) => snapshot.week === latestWeek);
    assert.equal(completeLegacySnapshot?.totals.hammers, 19);
    assert.equal(completeLegacySnapshot?.entries.length, 2);
    assert.equal(completeLegacySnapshot?.entries.find((entry) => entry.memberId === leaderId)?.resources.hammers, 7);
    const frozenWeeklyHistory = initialHistory.snapshots;

    const inventory = { ...EMPTY_RESOURCES, skillTickets: 159, mountKeys: 79, hammers: 20, eggsPetsTotal: 30 };
    const costs = { fiveSkills: 200, mount: 40 };
    const details = { ...CHANCE_PLANNING_DETAILS, skillLevel: 46, mountLevel: 72, extraMountChancePercent: 20, extraPetSummonPercent: 25 };
    const versionsBeforeRejectedSave = (await db.query("SELECT id FROM bank_versions WHERE member_id=$1", [memberId])).length;
    await assert.rejects(saveBank(member, { resources: inventory, notes: "Legacy costs and missing chances are incomplete" }, db), failure("BANK_INCOMPLETE"));
    assert.equal((await db.query("SELECT id FROM bank_versions WHERE member_id=$1", [memberId])).length, versionsBeforeRejectedSave);
    assert.equal((await getDew(member, db)).balance, 0);
    assert.equal(new Date(String((await db.query("SELECT last_updated_at FROM app_members WHERE id=$1", [memberId]))[0].last_updated_at)).toISOString(), latestUpdatedAt.replace("Z", ".000Z"));
    const saved = await saveBank(member, { resources: inventory, summoningCosts: costs, planningDetails: details, notes: "Live inventory" }, db);
    assert.deepEqual(saved.summoningCosts, costs);
    assert.deepEqual(saved.planningDetails, details);
    assert.equal((await getDew(member, db)).balance, 20);
    const firstManual = await captureSnapshot(leader, db);
    await Promise.all([
      saveBank(member, { resources: { ...inventory, hammers: 25 }, notes: "Updated inventory" }, db),
      saveBank(member, { resources: { ...inventory, hammers: 25 }, notes: "Same inventory" }, db),
    ]);
    const current = await liveDashboard(leader, db);
    assert.equal(current.totals.hammers, 95);
    assert.equal(current.summons.skills, 3);
    assert.equal(current.summons.mounts, 1);
    assert.deepEqual(current.entries.find((entry) => entry.memberId === memberId)?.summoningCosts, costs);
    assert.deepEqual(current.entries.find((entry) => entry.memberId === memberId)?.planningDetails, details);
    assert.equal((await getDew(member, db)).balance, 20);
    assert.equal((await db.query("SELECT member_id FROM dew_weekly_earnings WHERE member_id=$1 AND reason='resources'", [memberId])).length, 1);
    assert.equal((await db.query("SELECT member_id FROM dew_earnings WHERE member_id=$1", [memberId])).length, 0);
    const secondManual = await captureSnapshot(leader, db);
    assert.notEqual(firstManual.id, secondManual.id);
    assert.equal((await historicalBankDashboard(leader, week, db, firstManual.id)).totals.hammers, 90);
    assert.equal((await historicalBankDashboard(leader, week, db, secondManual.id)).totals.hammers, 95);
    await assert.rejects(historicalBankDashboard(leader, oldWeek, db, firstManual.id), failure("SNAPSHOT_NOT_FOUND"));

    const sessionToken = await createSession(member, {
      access_token: "test-only-access",refresh_token: "test-only-refresh",expires_in: 3600,
      token_type: "Bearer",scope: "identify guilds.members.read",
    }, db);
    assert.equal(SESSION_SECONDS, 180 * 24 * 60 * 60);
    const tokenHash = hashToken(sessionToken);
    let session = (await db.query("SELECT * FROM auth_sessions WHERE token_hash=$1", [tokenHash]))[0];
    assert.notEqual(session.token_hash, sessionToken);
    assert.notEqual(session.encrypted_access_token, "test-only-access");
    await db.query("UPDATE auth_sessions SET expires_at=NOW()+INTERVAL '2 hours' WHERE token_hash=$1", [tokenHash]);
    assert.equal((await authenticatedMember(sessionToken, { db }))?.id, memberId);
    session = (await db.query("SELECT * FROM auth_sessions WHERE token_hash=$1", [tokenHash]))[0];
    assert.ok(new Date(String(session.expires_at)).getTime() > Date.now() + 179 * 86_400_000);
    await db.query(`UPDATE auth_sessions SET membership_checked_at=NOW()-INTERVAL '6 minutes',
      oauth_expires_at=NOW()-INTERVAL '1 minute' WHERE token_hash=$1`, [tokenHash]);
    let refreshes = 0;
    let checks = 0;
    const fetcher = (async (url, options) => {
      if (String(url).endsWith("/oauth2/token")) {
        refreshes++;
        assert.equal((options?.body as URLSearchParams).get("refresh_token"), "test-only-refresh");
        return Response.json({ access_token: "rotated-test-access",refresh_token: "rotated-test-refresh",expires_in: 3600,
          token_type: "Bearer",scope: "identify guilds.members.read" });
      }
      checks++;
      assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer rotated-test-access");
      return Response.json({ roles: [],nick: "Returning member" });
    }) as typeof fetch;
    const authenticated = await Promise.all([
      authenticatedMember(sessionToken, { db, fetcher }),
      authenticatedMember(sessionToken, { db, fetcher }),
    ]);
    assert.equal(authenticated.every((account) => account?.id === memberId), true);
    assert.equal(refreshes, 1);
    assert.equal(checks, 1);
    session = (await db.query("SELECT * FROM auth_sessions WHERE token_hash=$1", [tokenHash]))[0];
    assert.equal(decrypt(String(session.encrypted_refresh_token)), "rotated-test-refresh");

    const plan = await createSnipe(leader, { title: "PostgreSQL planning smoke",startsAt: new Date(Date.now() + 86_400_000).toISOString(),activities: ["hammers"] }, db);
    const attendance = await respondToSnipe(member, plan.id, { answer: "yes" }, db);
    assert.deepEqual(attendance.counts, { yes: 1,no: 0,unanswered: 1 });
    assert.equal(attendance.estimate.minimum, 50);
    assert.equal(attendance.estimate.maximum, 125);
    assert.equal((await getDew(member, db)).snipeRewardEarned, false);
    const startedAt = new Date(Math.max(Date.now() - 1000, new Date(`${week}T00:00:00Z`).getTime())).toISOString();
    await db.query("UPDATE snipe_plans SET starts_at=$2 WHERE id=$1", [plan.id, startedAt]);
    const confirmed = await confirmSnipeAttendance(leader, plan.id, { memberId, attended: true }, db);
    assert.equal(confirmed.attendees?.[0].member?.username, "Returning member");
    assert.equal((await getDew(member, db)).balance, 30);
    await confirmSnipeAttendance(leader, plan.id, { memberId, attended: true }, db);
    assert.equal((await getDew(member, db)).balance, 30);
    const archive = await updateSnipe(leader, plan.id, { archived: true }, db);
    assert.equal(archive.participants[0].member.username, "Returning member");
    assert.equal(archive.archived, true);

    const reward = DEW_ITEMS[0];
    await db.query("UPDATE dew_balances SET balance=0 WHERE member_id=$1", [memberId]);
    await assert.rejects(purchaseDewItem(member, reward.id, db), failure("INSUFFICIENT_DEW"));
    await db.query("UPDATE dew_balances SET balance=$2 WHERE member_id=$1", [memberId, reward.cost]);
    const purchases = await Promise.all([purchaseDewItem(member, reward.id, db), purchaseDewItem(member, reward.id, db)]);
    assert.equal(purchases.every((purchase) => purchase.balance === 0), true);
    assert.deepEqual((await getDew(member, db)).owned, [reward.id]);
    assert.equal((await equipDewItem(member, reward.id, db)).equipped, reward.id);
    assert.equal((await db.query("SELECT badge FROM app_members WHERE id=$1", [memberId]))[0].badge, reward.id);

    await saveBank(member, { resources: { ...inventory, hammers: 999 }, notes: "After archives" }, db);
    await initializeSchema(db);
    assert.deepEqual((await db.query("SELECT started_at FROM bank_history_state WHERE id='live-banks'"))[0], initialHistoryState);
    assert.equal((await db.query("SELECT id FROM bank_versions WHERE member_id=$1", [memberId])).length, 5);
    assert.equal((await liveDashboard(leader, db)).totals.hammers, 1069);
    await updateMember(leader, memberId, { active: false }, db);
    assert.equal(await authenticatedMember(sessionToken, { db }), null);
    assert.equal((await db.query("SELECT token_hash FROM auth_sessions WHERE member_id=$1", [memberId])).length, 0);
    assert.equal((await liveDashboard(leader, db)).totals.hammers, 70);
    assert.deepEqual((await listSnipes(leader, db)).plans.find((item) => item.id === archive.id), archive);
    await assert.rejects(respondToSnipe(leader, plan.id, { answer: "yes" }, db), failure("SNIPE_ARCHIVED"));
    const finalHistory = await bankHistory(leader, db);
    assert.deepEqual(finalHistory.snapshots.filter((snapshot) => !snapshot.id), frozenWeeklyHistory);
    assert.deepEqual(finalHistory.snapshots.find((snapshot) => snapshot.id === firstManual.id), firstManual);
    assert.equal((await historicalBankDashboard(leader, week, db, firstManual.id)).totals.hammers, 90);
    await assert.rejects(saveBank(member, { resources: inventory, notes: "Stale account" }, db), failure("ACCOUNT_INACTIVE"));
    assert.equal((await db.query("SELECT id FROM resource_entries WHERE id=$1", [oldEntryId])).length, 1);
    const promoted = await updateMember(leader, memberId, { active: true,role: "ADMIN" }, db);
    await updateMember(promoted, leaderId, { role: "MEMBER" }, db);
    await assert.rejects(saveBank(leader, { memberId,resources: inventory,notes: "Stale administrator" }, db), failure("FORBIDDEN"));
    await assert.rejects(captureSnapshot(leader, db), failure("ADMIN_REQUIRED"));
    assert.equal(await authenticatedMember(sessionToken, { db }), null);
  } finally {
    try {
      await db?.close();
      await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await control.close();
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }
});
