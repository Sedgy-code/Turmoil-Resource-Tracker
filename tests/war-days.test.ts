import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Member } from "../src/lib/types";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import { getClanDays, setClanDays, warDayReport } from "../src/lib/server/war-days";
import { saveWarResult } from "../src/lib/server/war-results";
import { warWeekOf } from "../src/lib/war-calendar";

const apiFailure = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;
const WEEK = "2026-10-12";
const DURING_WAR = new Date("2026-10-15T12:00:00Z");

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
  try { await initializeSchema(db); await work(db); } finally { await db.close(); }
}
async function addMember(db: Database, username: string, role: Member["role"] = "MEMBER"): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,$2,$3,$4) RETURNING *", [randomUUID(), randomUUID(), username, role]);
  return memberFromRow(rows[0]);
}
const day = (admin: Member, warDay: number, rows: { member: Member | null; name?: string; points: number }[], db: Database) =>
  saveWarResult(admin, {
    kind: "warday", warDay, week: WEEK, label: "", clanTotal: null, images: [],
    rows: rows.map((row) => ({ gameName: row.name ?? row.member!.username, memberId: row.member?.id ?? null, points: row.points })),
  }, db);

test("the war a daily upload belongs to is the one that started on the Tuesday", () => {
  assert.equal(warWeekOf(DURING_WAR), WEEK);
});

test("every member can see the clan days; only admins pick them", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    const member = await addMember(db, "member");
    assert.deepEqual(await getClanDays(member, WEEK, db), { week: WEEK, days: [] });
    await assert.rejects(setClanDays(member, { week: WEEK, days: [1] }, db), apiFailure("ADMIN_REQUIRED"));
    assert.deepEqual(await setClanDays(admin, { week: WEEK, days: [3, 1, 3] }, db), { week: WEEK, days: [1, 3] });
    assert.deepEqual((await getClanDays(member, WEEK, db)).days, [1, 3]);
    assert.deepEqual((await setClanDays(admin, { week: WEEK, days: [] }, db)).days, []);
  });
});

test("one upload per war day, and it must say which day", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    await assert.rejects(saveWarResult(admin, { kind: "warday", week: WEEK, label: "", clanTotal: 5, rows: [], images: [] }, db), apiFailure("INVALID_WAR_DAY"));
    const saved = await day(admin, 1, [{ member: admin, points: 10 }], db);
    assert.equal(saved.warDay, 1);
    await assert.rejects(day(admin, 1, [{ member: admin, points: 20 }], db), apiFailure("WAR_DAY_TAKEN"));
  });
});

test("points on clan days count; too much on other days earns a black mark", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    const loyal = await addMember(db, "loyal");
    const offday = await addMember(db, "offday");
    const slip = await addMember(db, "slip");
    const idle = await addMember(db, "idle");
    await setClanDays(admin, { week: WEEK, days: [1, 3] }, db);
    await day(admin, 1, [{ member: loyal, points: 100 }, { member: offday, points: 50 }, { member: slip, points: 95 }, { member: null, name: "Guest", points: 7 }], db);
    await day(admin, 2, [{ member: offday, points: 50 }, { member: slip, points: 5 }], db);
    await day(admin, 3, [{ member: loyal, points: 100 }], db);
    const report = await warDayReport(idle, WEEK, db, DURING_WAR);
    assert.deepEqual(report.clanDays, [1, 3]);
    assert.deepEqual(report.uploads.map((upload) => upload.warDay), [1, 2, 3]);
    assert.deepEqual(report.weeks, [WEEK]);
    const row = (name: string) => report.rows.find((item) => (item.member?.username ?? item.name) === name)!;
    assert.deepEqual([row("loyal").onClanDays, row("loyal").otherDays, row("loyal").blackMark], [200, 0, false]);
    assert.deepEqual([row("offday").onClanDays, row("offday").otherDays, row("offday").blackMark], [50, 50, true]);
    // 5 of 100 on another day is within the 10% allowance (auto-forge and the like).
    assert.deepEqual([row("slip").onClanDays, row("slip").otherDays, row("slip").blackMark], [95, 5, false]);
    assert.deepEqual(row("loyal").days, [100, null, 100, null, null]);
    assert.equal(row("Guest").member, null);
    assert.deepEqual(row("idle").days, [null, null, null, null, null], "members who scored nothing are listed too");
  });
});

test("the ranking rewards spending on clan days and docks black marks", async () => {
  const { contributionRanking, BLACK_MARK_PENALTY } = await import("../src/lib/server/ranking");
  await withDatabase(async (db) => {
    const admin = await addMember(db, "leader", "ADMIN");
    const loyal = await addMember(db, "loyal");
    const offday = await addMember(db, "offday");
    await db.query("UPDATE app_members SET joined_at = NOW() - INTERVAL '60 days'");
    await setClanDays(admin, { week: WEEK, days: [1, 3] }, db);
    await day(admin, 1, [{ member: loyal, points: 100 }, { member: offday, points: 10 }], db);
    await day(admin, 2, [{ member: offday, points: 90 }], db);
    const ranking = await contributionRanking(admin, db, DURING_WAR);
    assert.equal(ranking.weights.clanDays, 15);
    const loyalRow = ranking.rows.find((row) => row.member.id === loyal.id)!;
    const offdayRow = ranking.rows.find((row) => row.member.id === offday.id)!;
    assert.equal(loyalRow.clanDayShare, 1);
    assert.equal(offdayRow.clanDayShare, 0.1);
    assert.deepEqual([loyalRow.blackMarks, offdayRow.blackMarks], [0, 1]);
    assert.equal(offdayRow.penalty, BLACK_MARK_PENALTY);
    assert.ok(offdayRow.rank < loyalRow.rank, "spending on the wrong days ranks lower (nearer the top)");
  });
});
