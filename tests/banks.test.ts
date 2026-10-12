import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { CHANCE_PLANNING_DETAILS, currentWeek, EMPTY_PLANNING_DETAILS, EMPTY_RESOURCES, shiftWeek, type ResourceValues } from "../src/lib/resources";
import { DEFAULT_WAR_RATES, estimateWar } from "../src/lib/war";
import { bankHistory, captureSnapshot, captureWeeklySnapshots, historicalBankDashboard, liveDashboard, saveBank } from "../src/lib/server/banks";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import { saveEntry, updateMember } from "../src/lib/server/tracker";
import type { Member } from "../src/lib/types";

let db: Database;
let admin: Member;
let member: Member;
const failure = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const resources = (hammers: number) => ({ ...EMPTY_RESOURCES, hammers });
const completeInformation = {
  summoningCosts: { fiveSkills: 150, mount: 40 },
  planningDetails: { ...CHANCE_PLANNING_DETAILS },
};

async function createMember(username: string, role: Member["role"]): Promise<Member> {
  const id = randomUUID();
  const rows = await db.query(
    `INSERT INTO app_members (id,discord_id,username,role,joined_at) VALUES ($1,$2,$3,$4,'2026-09-28T00:00:00Z') RETURNING *`,
    [id, id, username, role],
  );
  await db.query(
    `INSERT INTO member_status_events (id,member_id,active,role,username,avatar_url,changed_at)
     VALUES ($1,$2,TRUE,$3,$4,NULL,'2026-09-28T00:00:00Z')`,
    [randomUUID(), id, role, username],
  );
  return memberFromRow(rows[0]);
}

async function version(hammers: number, at: string): Promise<void> {
  await db.query(
    `INSERT INTO bank_versions (id,member_id,resources,summoning_costs,planning_details,notes,updated_by,updated_at)
     VALUES ($1,$2,$3::jsonb,'{}'::jsonb,'{}'::jsonb,'',$2,$4)`,
    [randomUUID(), member.id, JSON.stringify(resources(hammers)), at],
  );
}

before(async () => {
  db = await openDatabase();
  await initializeSchema(db);
});
beforeEach(async () => {
  await db.query("TRUNCATE TABLE app_members CASCADE");
  // Snapshots deliberately have no member foreign keys: departing members must
  // never cascade-delete the frozen historical record.
  await db.query("DELETE FROM bank_snapshots");
  await db.query("DELETE FROM bank_manual_snapshots");
  admin = await createMember("Leader", "ADMIN");
  member = await createMember("Member", "MEMBER");
});
after(async () => { await db.close(); });

test("live banks carry resources, costs, and planning details into later weeks", async () => {
  const costs = { fiveSkills: 180, mount: 42 };
  const details = { ...CHANCE_PLANNING_DETAILS, skillLevel: 45, mountLevel: 72, eggMerges: 8 };
  await saveBank(member, { resources: resources(40), summoningCosts: costs, planningDetails: details, notes: "Ready" }, db);
  const edited = await saveBank(member, { resources: resources(45), notes: "Still ready" }, db);
  assert.deepEqual(edited.summoningCosts, costs);
  assert.deepEqual(edited.planningDetails, details);
  const live = await liveDashboard(admin, db);
  assert.equal(live.live, true);
  assert.equal(live.totals.hammers, 45);
  assert.equal(live.stats.submittedMembers, 1);
  assert.equal(live.currentUser.role, "ADMIN");
  const nextWeek = new Date(`${shiftWeek(currentWeek(), 1)}T00:00:00Z`);
  await captureWeeklySnapshots(db, nextWeek);
  assert.equal((await liveDashboard(member, db)).totals.hammers, 45);
  assert.equal((await db.query("SELECT id FROM bank_versions WHERE member_id=$1", [member.id])).length, 2);
  assert.equal((await db.query("SELECT id FROM resource_entries WHERE member_id=$1", [member.id])).length, 1);
});

test("only live-bank writes refresh a member, historical edits do not", async () => {
  await saveBank(member, { ...completeInformation, resources: resources(10), notes: "" }, db);
  const bank = (await db.query("SELECT updated_at FROM member_banks WHERE member_id=$1", [member.id]))[0];
  const fresh = (await db.query("SELECT last_updated_at FROM app_members WHERE id=$1", [member.id]))[0];
  assert.equal(new Date(String(bank.updated_at)).getTime(), new Date(String(fresh.last_updated_at)).getTime());
  await saveEntry(member, { week: "2026-09-28", resources: resources(999), notes: "Historical correction" }, db);
  const unchanged = (await db.query("SELECT last_updated_at FROM app_members WHERE id=$1", [member.id]))[0];
  assert.equal(new Date(String(unchanged.last_updated_at)).getTime(), new Date(String(fresh.last_updated_at)).getTime());
  assert.equal((await liveDashboard(member, db)).totals.hammers, 10);
});

test("live dashboard summons sum each member's whole affordable actions", async () => {
  const quantities = { ...resources(0), skillTickets: 159, mountKeys: 79 };
  const costs = { fiveSkills: 200, mount: 40 };
  await saveBank(admin, { ...completeInformation, resources: quantities, summoningCosts: costs, notes: "" }, db);
  await saveBank(member, { ...completeInformation, resources: quantities, summoningCosts: costs, notes: "" }, db);
  const live = await liveDashboard(admin, db);
  assert.equal(live.summons.skills, 6);
  assert.equal(live.summons.mounts, 2);
  await saveBank(member, { resources: { ...quantities, skillTickets: 351, mountKeys: 351 },
    summoningCosts: { fiveSkills: 175.5, mount: 43.875 }, notes: "Decimal boundary" }, db);
  const decimal = await liveDashboard(admin, db);
  assert.equal(decimal.summons.skills, 13);
  assert.equal(decimal.summons.mounts, 9);
});

test("complete zero banks and unchanged self saves qualify for 20 Dew once a week; admin edits do not", async () => {
  await saveBank(admin, { ...completeInformation, memberId: member.id, resources: resources(0), notes: "Leader recorded all information" }, db);
  assert.equal((await db.query("SELECT * FROM dew_balances")).length, 0);
  await saveBank(member, { resources: resources(0), notes: "Confirmed unchanged bank" }, db);
  assert.equal((await db.query("SELECT balance FROM dew_balances WHERE member_id=$1", [member.id]))[0].balance, 20);
  await saveBank(admin, { memberId: member.id, resources: resources(1), notes: "Leader update" }, db);
  await saveBank(member, { resources: resources(1), notes: "Only changed the note" }, db);
  await saveBank(member, { resources: resources(2), notes: "Changed inventory" }, db);
  await saveBank(member, { resources: resources(3), notes: "Changed again" }, db);
  const balances = await db.query("SELECT * FROM dew_balances WHERE member_id=$1", [member.id]);
  assert.equal(balances[0].balance, 20);
  const awards = await db.query("SELECT week_start::text AS week,reason,amount FROM dew_weekly_earnings WHERE member_id=$1", [member.id]);
  assert.deepEqual(awards, [{ week: currentWeek(), reason: "resources", amount: 20 }]);
  assert.equal((await db.query("SELECT * FROM dew_earnings WHERE member_id=$1", [member.id])).length, 0);
  assert.equal((await db.query("SELECT * FROM dew_balances WHERE member_id=$1", [admin.id])).length, 0);
});

test("incomplete bank submissions do not write inventory, history, freshness or rewards", async () => {
  const missingResource = { ...resources(0) } as Partial<ResourceValues>;
  delete missingResource.eggshellsTotal;
  const missingChance = { ...CHANCE_PLANNING_DETAILS };
  delete missingChance.extraPetSummonPercent;
  const invalidInputs = [
    { resources: resources(0), notes: "Missing all costs and details" },
    { ...completeInformation, resources: missingResource as ResourceValues, notes: "Missing eggshells" },
    { ...completeInformation, resources: resources(0), summoningCosts: { fiveSkills: 0, mount: 40 }, notes: "Invalid cost" },
    { ...completeInformation, resources: resources(0), planningDetails: missingChance, notes: "Missing chance" },
    { ...completeInformation, resources: resources(0), planningDetails: { ...EMPTY_PLANNING_DETAILS }, notes: "Old action counts are incomplete" },
    { ...completeInformation, resources: resources(0), planningDetails: { ...CHANCE_PLANNING_DETAILS, extraMountChancePercent: 0.001 }, notes: "Invalid precision" },
  ];
  for (const input of invalidInputs) await assert.rejects(saveBank(member, input, db), failure("BANK_INCOMPLETE"));
  for (const table of ["member_banks", "bank_versions", "resource_entries", "bank_snapshots", "dew_balances", "dew_weekly_earnings", "dew_earnings"]) {
    assert.equal((await db.query(`SELECT * FROM ${table}`)).length, 0, table);
  }
  assert.equal((await db.query("SELECT last_updated_at FROM app_members WHERE id=$1", [member.id]))[0].last_updated_at, null);
});

test("a rejected incomplete replacement preserves an existing complete bank and freshness", async () => {
  await saveBank(member, { ...completeInformation, resources: resources(20), notes: "Complete" }, db);
  const before = (await db.query("SELECT * FROM member_banks WHERE member_id=$1", [member.id]))[0];
  const profileBefore = (await db.query("SELECT last_updated_at FROM app_members WHERE id=$1", [member.id]))[0];
  await assert.rejects(saveBank(member, {
    resources: resources(999), planningDetails: { ...EMPTY_PLANNING_DETAILS }, notes: "Incomplete replacement",
  }, db), failure("BANK_INCOMPLETE"));
  assert.deepEqual((await db.query("SELECT * FROM member_banks WHERE member_id=$1", [member.id]))[0], before);
  assert.deepEqual((await db.query("SELECT last_updated_at FROM app_members WHERE id=$1", [member.id]))[0], profileBefore);
  assert.equal((await db.query("SELECT * FROM bank_versions WHERE member_id=$1", [member.id])).length, 1);
  assert.equal((await db.query("SELECT balance FROM dew_balances WHERE member_id=$1", [member.id]))[0].balance, 20);
});

test("concurrent complete bank confirmations award the weekly 20 points once", async () => {
  await Promise.all([
    saveBank(member, { ...completeInformation, resources: resources(0), notes: "First confirmation" }, db),
    saveBank(member, { ...completeInformation, resources: resources(0), notes: "Second confirmation" }, db),
  ]);
  assert.equal((await db.query("SELECT balance FROM dew_balances WHERE member_id=$1", [member.id]))[0].balance, 20);
  assert.equal((await db.query("SELECT * FROM dew_weekly_earnings WHERE member_id=$1", [member.id])).length, 1);
  assert.equal((await db.query("SELECT * FROM bank_versions WHERE member_id=$1", [member.id])).length, 2);
});

test("previous weekly awards and legacy daily balances remain while a new week's complete save earns 20", async () => {
  const priorWeek = shiftWeek(currentWeek(), -1);
  await saveBank(admin, { ...completeInformation, memberId: member.id, resources: resources(0), notes: "Imported confirmation" }, db);
  await db.query("INSERT INTO dew_balances (member_id,balance) VALUES ($1,27)", [member.id]);
  await db.query("INSERT INTO dew_weekly_earnings (member_id,week_start,reason,amount) VALUES ($1,$2,'resources',20)", [member.id, priorWeek]);
  await db.query("INSERT INTO dew_earnings (member_id,earned_on) VALUES ($1,$2)", [member.id, priorWeek]);
  await saveBank(member, { resources: resources(0), notes: "Unchanged but complete this week" }, db);
  await saveBank(member, { resources: resources(0), notes: "Repeated this week" }, db);
  assert.equal((await db.query("SELECT balance FROM dew_balances WHERE member_id=$1", [member.id]))[0].balance, 47);
  const weekly = await db.query("SELECT week_start::text AS week,reason,amount FROM dew_weekly_earnings WHERE member_id=$1 ORDER BY week_start", [member.id]);
  assert.deepEqual(weekly, [
    { week: priorWeek, reason: "resources", amount: 20 },
    { week: currentWeek(), reason: "resources", amount: 20 },
  ]);
  assert.equal((await db.query("SELECT * FROM dew_earnings WHERE member_id=$1", [member.id])).length, 1);
});

test("complete chance inputs are saved as version 2 even when the client omits the model marker", async () => {
  const details = { ...CHANCE_PLANNING_DETAILS };
  delete details.calculationVersion;
  const saved = await saveBank(member, { ...completeInformation, planningDetails: details, resources: resources(0), notes: "New fields" }, db);
  assert.equal(saved.planningDetails?.calculationVersion, 2);
  assert.equal(((await db.query("SELECT planning_details FROM bank_versions WHERE member_id=$1", [member.id]))[0].planning_details as { calculationVersion: number }).calculationVersion, 2);
});

test("bank authorization rereads roles and active status inside the transaction", async () => {
  await assert.rejects(saveBank(member, { memberId: admin.id, resources: resources(20), notes: "" }, db), failure("FORBIDDEN"));
  await saveBank(admin, { ...completeInformation, memberId: member.id, resources: resources(30), notes: "Leader edit" }, db);
  const replacement = await updateMember(admin, member.id, { role: "ADMIN" }, db);
  await updateMember(replacement, admin.id, { role: "MEMBER" }, db);
  await assert.rejects(saveBank(admin, { memberId: member.id, resources: resources(50), notes: "" }, db), failure("FORBIDDEN"));
  await updateMember(replacement, admin.id, { active: false }, db);
  await assert.rejects(saveBank(admin, { resources: resources(50), notes: "" }, db), failure("ACCOUNT_INACTIVE"));
  await assert.rejects(liveDashboard(admin, db), failure("ACCOUNT_INACTIVE"));
  await assert.rejects(bankHistory(admin, db), failure("ACCOUNT_INACTIVE"));
  assert.equal((await liveDashboard(replacement, db)).totals.hammers, 30);
});

test("delayed weekly capture replays bank versions at each Monday cutoff", async () => {
  await version(20, "2026-10-01T12:00:00Z");
  await version(40, "2026-10-07T12:00:00Z");
  await version(60, "2026-10-13T12:00:00Z");
  const captured = await captureWeeklySnapshots(db, new Date("2026-10-19T00:00:00Z"));
  assert.equal(captured, 3);
  const rows = await db.query("SELECT * FROM bank_snapshots ORDER BY week_start");
  assert.deepEqual(rows.map((row) => (row.totals as { hammers: number }).hammers), [20, 40, 60]);
  const firstEntries = rows[0].entries as { updatedAt: string }[];
  assert.equal(firstEntries[0].updatedAt, "2026-10-01T12:00:00.000Z");
  const firstMembers = rows[0].members as Member[];
  assert.equal(firstMembers.find((item) => item.id === member.id)?.lastUpdatedAt, "2026-10-01T12:00:00.000Z");
  assert.equal(await captureWeeklySnapshots(db, new Date("2026-10-19T23:59:00Z")), 0);
  assert.equal((await db.query("SELECT week_start FROM bank_snapshots")).length, 3);
});

test("Monday midnight writes and roster changes belong to the new week", async () => {
  await version(20, "2026-10-04T23:59:59Z");
  await version(40, "2026-10-05T00:00:00Z");
  await db.query(
    `INSERT INTO member_status_events (id,member_id,active,role,username,avatar_url,changed_at)
     VALUES ($1,$2,FALSE,'MEMBER','Member',NULL,'2026-10-05T00:00:00Z')`,
    [randomUUID(), member.id],
  );
  await captureWeeklySnapshots(db, new Date("2026-10-12T00:00:00Z"));
  const rows = await db.query("SELECT * FROM bank_snapshots ORDER BY week_start");
  assert.deepEqual(rows.map((row) => (row.totals as { hammers: number }).hammers), [20, 0]);
  assert.equal((rows[0].members as Member[]).some((item) => item.id === member.id), true);
  assert.equal((rows[1].members as Member[]).some((item) => item.id === member.id), false);
});

test("weekly replay uses historical roster activity and preserves existing snapshots", async () => {
  await version(20, "2026-10-01T12:00:00Z");
  await version(40, "2026-10-07T12:00:00Z");
  await db.query(
    `INSERT INTO member_status_events (id,member_id,active,role,username,avatar_url,changed_at)
     VALUES ($1,$2,FALSE,'MEMBER','Old nickname',NULL,'2026-10-14T12:00:00Z')`,
    [randomUUID(), member.id],
  );
  await db.query("UPDATE app_members SET active=FALSE,username='New nickname' WHERE id=$1", [member.id]);
  await captureWeeklySnapshots(db, new Date("2026-10-19T00:00:00Z"));
  let rows = await db.query("SELECT * FROM bank_snapshots ORDER BY week_start");
  assert.deepEqual(rows.map((row) => (row.totals as { hammers: number }).hammers), [20, 40, 0]);
  assert.equal((rows[0].members as Member[]).find((item) => item.id === member.id)?.username, "Member");
  const frozen = JSON.stringify(rows);
  await version(900, "2026-10-07T18:00:00Z");
  await db.query("UPDATE app_members SET active=TRUE WHERE id=$1", [member.id]);
  assert.equal(await captureWeeklySnapshots(db, new Date("2026-10-19T00:00:00Z")), 0);
  rows = await db.query("SELECT * FROM bank_snapshots ORDER BY week_start");
  assert.equal(JSON.stringify(rows), frozen);
});

test("manual snapshots are admin-only, individually immutable, and safe when requested together", async () => {
  await saveBank(member, { ...completeInformation, resources: resources(50), notes: "" }, db);
  await assert.rejects(captureSnapshot(member, db), failure("ADMIN_REQUIRED"));
  const [first, second] = await Promise.all([captureSnapshot(admin, db), captureSnapshot(admin, db)]);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.totals, second.totals);
  assert.equal(first.automatic, false);
  assert.equal(first.totals.hammers, 50);
  await saveBank(member, { resources: resources(80), notes: "Changed after snapshot" }, db);
  const third = await captureSnapshot(admin, db);
  assert.equal(third.totals.hammers, 80);
  await updateMember(admin, member.id, { active: false }, db);
  const history = await bankHistory(admin, db);
  assert.deepEqual(history.snapshots.find((snapshot) => snapshot.id === first.id), first);
  assert.equal(first.members.find((item) => item.id === member.id)?.active, true);
  assert.equal(history.current.totals.hammers, 0);
});

test("manual midweek captures never suppress the automatic completed-week snapshot", async () => {
  await saveBank(member, { ...completeInformation, resources: resources(50), notes: "" }, db);
  const manual = await captureSnapshot(admin, db);
  await saveBank(member, { resources: resources(80), notes: "After manual capture" }, db);
  const nextWeek = new Date(`${shiftWeek(currentWeek(), 1)}T00:00:00Z`);
  await captureWeeklySnapshots(db, nextWeek);
  const history = await bankHistory(admin, db);
  assert.equal(history.snapshots.find((snapshot) => snapshot.id === manual.id)?.totals.hammers, 50);
  const automatic = history.snapshots.find((snapshot) => snapshot.week === manual.week && !snapshot.id);
  assert.equal(automatic?.automatic, true);
  assert.equal(automatic?.totals.hammers, 80);
  assert.equal((await historicalBankDashboard(admin, manual.week, db)).totals.hammers, 80);
});

test("manual snapshot IDs select the exact frozen record and require the matching week", async () => {
  await saveBank(member, { ...completeInformation, resources: resources(50), notes: "" }, db);
  const first = await captureSnapshot(admin, db);
  await saveBank(member, { resources: resources(80), notes: "" }, db);
  const second = await captureSnapshot(admin, db);
  const firstRead = await historicalBankDashboard(admin, first.week, db, first.id);
  const secondRead = await historicalBankDashboard(admin, second.week, db, second.id);
  assert.equal(firstRead.live, false);
  assert.equal(firstRead.totals.hammers, 50);
  assert.equal(secondRead.totals.hammers, 80);
  await assert.rejects(historicalBankDashboard(admin, first.week, db, randomUUID()), failure("SNAPSHOT_NOT_FOUND"));
  await assert.rejects(historicalBankDashboard(admin, shiftWeek(first.week, -1), db, first.id), failure("SNAPSHOT_NOT_FOUND"));
});

test("legacy snapshots read zero eggshells without mutating their stored JSON or scoring model", async () => {
  const week = shiftWeek(currentWeek(), -2);
  const legacyResources = { skillTickets: 0, eggsPetsTotal: 23, mountKeys: 0, mountsToMerge: 0, hammers: 7 };
  const entries = [{
    id: randomUUID(), memberId: member.id, week,
    resources: legacyResources, summoningCosts: { fiveSkills: 150, mount: 40 },
    planningDetails: { ...EMPTY_PLANNING_DETAILS, eggMerges: 4 }, notes: "Original counts",
    updatedAt: `${week}T12:00:00.000Z`, updatedBy: { id: member.id, username: member.username },
  }];
  await db.query(`INSERT INTO bank_snapshots (week_start,captured_at,automatic,members,entries,totals)
    VALUES ($1,$2,FALSE,$3::jsonb,$4::jsonb,$5::jsonb)`,
  [week, new Date().toISOString(), JSON.stringify([member]), JSON.stringify(entries), JSON.stringify(legacyResources)]);
  const rawBefore = (await db.query("SELECT * FROM bank_snapshots WHERE week_start=$1", [week]))[0];
  const historical = await historicalBankDashboard(admin, week, db);
  assert.equal(historical.totals.eggshellsTotal, 0);
  assert.equal(historical.entries[0].resources.eggshellsTotal, 0);
  assert.equal(historical.summons.skills, 0);
  assert.equal(estimateWar(historical.entries, DEFAULT_WAR_RATES, ["eggMerges"], "historical").rows[0].quantity, 4);
  assert.deepEqual((await db.query("SELECT * FROM bank_snapshots WHERE week_start=$1", [week]))[0], rawBefore);
  assert.equal("eggshellsTotal" in (rawBefore.totals as object), false);
});

test("automatic snapshots freeze the war model at activation while fresh manual snapshots use version 2", async () => {
  const marker = (await db.query("SELECT started_at FROM bank_history_state WHERE id='chance-war-estimates'"))[0].started_at;
  try {
    await db.query("UPDATE bank_history_state SET started_at='2026-10-12T00:00:00Z' WHERE id='chance-war-estimates'");
    const legacyDetails = { ...EMPTY_PLANNING_DETAILS, eggMerges: 4 };
    const values = { ...resources(7), eggsPetsTotal: 23 };
    await db.query(`INSERT INTO bank_versions (id,member_id,resources,summoning_costs,planning_details,notes,updated_by,updated_at)
      VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'Before model change',$2,'2026-10-01T12:00:00Z')`,
    [randomUUID(), member.id, JSON.stringify(values), JSON.stringify(completeInformation.summoningCosts), JSON.stringify(legacyDetails)]);
    await captureWeeklySnapshots(db, new Date("2026-10-19T00:00:00Z"));
    const snapshots = await db.query("SELECT week_start::text AS week,entries FROM bank_snapshots ORDER BY week_start");
    const legacy = (snapshots.find((row) => row.week === "2026-09-28")!.entries as { planningDetails: typeof legacyDetails }[])[0];
    const boundary = (snapshots.find((row) => row.week === "2026-10-05")!.entries as { planningDetails: typeof legacyDetails }[])[0];
    const modern = (snapshots.find((row) => row.week === "2026-10-12")!.entries as { planningDetails: typeof CHANCE_PLANNING_DETAILS }[])[0];
    assert.equal(legacy.planningDetails.calculationVersion, undefined);
    assert.equal(boundary.planningDetails.calculationVersion, undefined);
    assert.equal(modern.planningDetails.calculationVersion, 2);
    const history = await bankHistory(admin, db);
    const oldEntries = history.snapshots.find((snapshot) => snapshot.week === "2026-09-28")!.entries;
    const boundaryEntries = history.snapshots.find((snapshot) => snapshot.week === "2026-10-05")!.entries;
    const newEntries = history.snapshots.find((snapshot) => snapshot.week === "2026-10-12")!.entries;
    assert.equal(estimateWar(oldEntries, DEFAULT_WAR_RATES, ["eggMerges"], "historical").rows[0].quantity, 4);
    assert.equal(estimateWar(boundaryEntries, DEFAULT_WAR_RATES, ["eggMerges"], "historical").rows[0].quantity, 4);
    assert.equal(estimateWar(newEntries, DEFAULT_WAR_RATES, ["eggMerges"], "historical").rows[0].quantity, 23);
    const original = (await db.query("SELECT planning_details FROM bank_versions WHERE member_id=$1", [member.id]))[0].planning_details;
    assert.deepEqual(original, legacyDetails);
    await saveBank(member, { ...completeInformation, resources: values, notes: "Current bank" }, db);
    const manual = await captureSnapshot(admin, db);
    assert.equal(manual.entries.find((entry) => entry.memberId === member.id)?.planningDetails?.calculationVersion, 2);
  } finally {
    await db.query("UPDATE bank_history_state SET started_at=$1 WHERE id='chance-war-estimates'", [marker]);
  }
});

test("legacy submitted weeks remain available and frozen after a member leaves", async () => {
  await saveEntry(member, { week: "2026-09-28", resources: resources(70), notes: "Imported old week" }, db);
  await db.query("UPDATE app_members SET active=FALSE WHERE id=$1", [member.id]);
  const history = await bankHistory(admin, db);
  const imported = history.snapshots.find((snapshot) => snapshot.week === "2026-09-28");
  assert.equal(imported?.totals.hammers, 70);
  assert.equal(imported?.entries[0].notes, "Imported old week");
  await db.query("UPDATE resource_entries SET resources=$1::jsonb WHERE member_id=$2", [JSON.stringify(resources(500)), member.id]);
  assert.deepEqual((await bankHistory(admin, db)).snapshots.find((snapshot) => snapshot.week === "2026-09-28"), imported);
});

test("migration preserves all prior-week submissions when initial banks come from different weeks", async () => {
  const previousWeek = shiftWeek(currentWeek(), -1);
  const thisWeek = currentWeek();
  await saveEntry(admin, { week: previousWeek,resources: resources(10),notes: "Leader's original prior bank" }, db);
  await saveEntry(member, { week: previousWeek,resources: resources(20),notes: "Member's original prior bank" }, db);
  await saveEntry(admin, { week: thisWeek,resources: resources(100),notes: "Leader's newer current bank" }, db);
  await db.query("UPDATE resource_entries SET updated_at=$1 WHERE week_start=$2", [`${previousWeek}T12:00:00Z`, previousWeek]);
  await db.query("UPDATE resource_entries SET updated_at=$1 WHERE week_start=$2", [`${thisWeek}T12:00:00Z`, thisWeek]);
  await initializeSchema(db);
  const migrated = await bankHistory(admin, db);
  const snapshot = migrated.snapshots.find((item) => item.week === previousWeek);
  assert.equal(snapshot?.entries.length, 2);
  assert.equal(snapshot?.totals.hammers, 30);
  assert.equal(snapshot?.entries.find((entry) => entry.memberId === admin.id)?.resources.hammers, 10);
  assert.equal(snapshot?.entries.find((entry) => entry.memberId === member.id)?.resources.hammers, 20);
  assert.equal(migrated.current.totals.hammers, 120);
  await saveBank(admin, { ...completeInformation, resources: resources(200),notes: "First real live update" }, db);
  const afterLiveUpdate = await bankHistory(admin, db);
  assert.deepEqual(afterLiveUpdate.snapshots.find((item) => item.week === previousWeek), snapshot);
});

test("unchanged migrated banks are captured every week after activation without a live save", async () => {
  const startWeek = currentWeek();
  const previousWeek = shiftWeek(startWeek, -1);
  await saveEntry(admin, { week: previousWeek,resources: resources(10),notes: "Unchanged migrated bank" }, db);
  await saveEntry(member, { week: previousWeek,resources: resources(20),notes: "Another unchanged bank" }, db);
  await db.query("UPDATE resource_entries SET updated_at=$1", [`${previousWeek}T12:00:00Z`]);
  await initializeSchema(db);
  const markerBefore = (await db.query("SELECT started_at FROM bank_history_state WHERE id='live-banks'"))[0];
  await initializeSchema(db);
  const markerAfter = (await db.query("SELECT started_at FROM bank_history_state WHERE id='live-banks'"))[0];
  assert.deepEqual(markerAfter, markerBefore);
  assert.equal((await db.query("SELECT id FROM bank_versions WHERE id NOT LIKE 'initial:%'")).length, 0);
  assert.equal(await captureWeeklySnapshots(db, new Date(`${shiftWeek(startWeek, 3)}T00:00:00Z`)), 4);
  const rows = await db.query("SELECT *,week_start::text AS week FROM bank_snapshots ORDER BY week_start");
  assert.deepEqual(rows.map((row) => String(row.week)), [previousWeek,startWeek,shiftWeek(startWeek,1),shiftWeek(startWeek,2)]);
  assert.deepEqual(rows.map((row) => (row.totals as { hammers: number }).hammers), [30,30,30,30]);
  assert.deepEqual(rows.map((row) => row.automatic), [false,true,true,true]);
  assert.equal(await captureWeeklySnapshots(db, new Date(`${shiftWeek(startWeek, 3)}T12:00:00Z`)), 0);
  assert.equal((await db.query("SELECT id FROM bank_versions WHERE id NOT LIKE 'initial:%'")).length, 0);
});

test("a newly registered member receives a baseline before roster changes", async () => {
  await db.query("DELETE FROM member_status_events WHERE member_id=$1", [member.id]);
  await updateMember(admin, member.id, { active: false }, db);
  const rows = await db.query("SELECT * FROM member_status_events WHERE member_id=$1 ORDER BY changed_at", [member.id]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].active, true);
  assert.equal(rows[1].active, false);
});
