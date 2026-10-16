import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Member } from "../src/lib/types";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { hoardingLevel, hoardingReport, saveHoardingNote, warSpending } from "../src/lib/server/hoarding";
import { memberFromRow } from "../src/lib/server/mappers";

const DAY = 86_400_000;
const apiFailure = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
  try { await initializeSchema(db); await work(db); } finally { await db.close(); }
}

async function addMember(db: Database, username: string, role: Member["role"] = "MEMBER"): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,$2,$3,$4) RETURNING *", [randomUUID(), randomUUID(), username, role]);
  return memberFromRow(rows[0]);
}

/** Records a save of `hammers` (worth 2 war points each at the low estimate) `daysAgo` days ago. */
async function saveHammers(db: Database, member: Member, hammers: number, daysAgo: number) {
  const at = new Date(Date.now() - daysAgo * DAY).toISOString();
  const resources = JSON.stringify({ hammers });
  await db.query(`INSERT INTO bank_versions (id,member_id,resources,summoning_costs,planning_details,notes,updated_at,updated_by)
    VALUES ($1,$2,$3::jsonb,'{}'::jsonb,'{}'::jsonb,'',$4,$2)`, [randomUUID(), member.id, resources, at]);
  await db.query(`INSERT INTO member_banks (member_id,resources,summoning_costs,planning_details,notes,updated_at,updated_by)
    VALUES ($1,$2::jsonb,'{}'::jsonb,'{}'::jsonb,'',$3,$1)
    ON CONFLICT (member_id) DO UPDATE SET resources=EXCLUDED.resources, updated_at=EXCLUDED.updated_at`, [member.id, resources, at]);
}

test("levels combine a large stockpile with growth or skipped snipes", () => {
  assert.equal(hoardingLevel(["large", "growing"]), "high");
  assert.equal(hoardingLevel(["large", "skipsSnipes"]), "high");
  assert.equal(hoardingLevel(["large"]), "watch");
  assert.equal(hoardingLevel(["growing"]), "watch");
  assert.equal(hoardingLevel(["stale"]), "ok");
  assert.equal(hoardingLevel([]), "ok");
});

test("a member who keeps growing a large stockpile without spending is flagged high", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Leader", "ADMIN");
    const hoarder = await addMember(db, "Hoarder");
    const spender = await addMember(db, "Spender");
    const normal = await addMember(db, "Normal");
    await saveHammers(db, admin, 1000, 2);
    await saveHammers(db, normal, 1000, 2);
    for (const [hammers, daysAgo] of [[5000, 40], [7000, 25], [9000, 10], [12000, 2]]) await saveHammers(db, hoarder, hammers, daysAgo);
    for (const [hammers, daysAgo] of [[5000, 40], [9000, 25], [1000, 10], [1500, 2]]) await saveHammers(db, spender, hammers, daysAgo);
    const report = await hoardingReport(admin, db);
    const row = (name: string) => report.rows.find(({ member }) => member.username === name)!;
    assert.equal(report.rows[0].member.username, "Hoarder");
    assert.equal(row("Hoarder").level, "high");
    assert.deepEqual(row("Hoarder").reasons, ["large", "growing"]);
    assert.equal(row("Hoarder").change, 12000 * 2 - 5000 * 2);
    assert.equal(row("Hoarder").spendsRecently, 0);
    assert.equal(row("Spender").level, "ok");
    assert.equal(row("Spender").spendsRecently, 1);
    assert.equal(row("Normal").level, "ok");
  });
});

test("only snipes with ticked attendance count as skipped", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Leader", "ADMIN");
    const absent = await addMember(db, "Absent");
    await saveHammers(db, admin, 1000, 1);
    await saveHammers(db, absent, 1000, 1);
    const snipe = async (ticked: boolean) => {
      const id = randomUUID();
      await db.query(`INSERT INTO snipe_plans (id,title,starts_at,activities,archived,created_by)
        VALUES ($1,'Snipe',$2,'["hammers"]'::jsonb,FALSE,$3)`, [id, new Date(Date.now() - 3 * DAY).toISOString(), admin.id]);
      if (ticked) await db.query("INSERT INTO snipe_attendance (snipe_id,member_id,confirmed_by) VALUES ($1,$2,$2)", [id, admin.id]);
    };
    await snipe(false);
    await snipe(false);
    let row = (await hoardingReport(admin, db)).rows.find(({ member }) => member.id === absent.id)!;
    assert.equal(row.snipes.held, 0);
    assert.equal(row.reasons.includes("skipsSnipes"), false);
    await snipe(true);
    await snipe(true);
    row = (await hoardingReport(admin, db)).rows.find(({ member }) => member.id === absent.id)!;
    assert.deepEqual(row.snipes, { held: 2, saidYes: 0, attended: 0 });
    assert.equal(row.reasons.includes("skipsSnipes"), true);
  });
});

test("only admins see the report and keep private notes", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Leader", "ADMIN");
    const member = await addMember(db, "Member");
    await assert.rejects(hoardingReport(member, db), apiFailure("ADMIN_REQUIRED"));
    await assert.rejects(saveHoardingNote(member, { memberId: member.id, note: "hi" }, db), apiFailure("ADMIN_REQUIRED"));
    await saveHoardingNote(admin, { memberId: member.id, note: "  Asked to spend in next war  " }, db);
    const row = (await hoardingReport(admin, db)).rows.find(({ member: m }) => m.id === member.id)!;
    assert.equal(row.note, "Asked to spend in next war");
    assert.equal(row.noteBy, "Leader");
    assert.equal(row.reasons.includes("stale"), true);
    await saveHoardingNote(admin, { memberId: member.id, note: "" }, db);
    assert.equal((await hoardingReport(admin, db)).rows.find(({ member: m }) => m.id === member.id)!.note, "");
  });
});

test("during a war: who saved and who spent, compared with their saves before and after", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Leader", "ADMIN");
    const saver = await addMember(db, "Saver");
    const spender = await addMember(db, "Spender");
    const quiet = await addMember(db, "Quiet");
    const { currentWeek } = await import("../src/lib/resources");
    const week = currentWeek(new Date(Date.now() - 10 * DAY));
    const weekStart = new Date(`${week}T00:00:00Z`).getTime();
    const daysAgo = (time: number) => (Date.now() - time) / DAY;
    await saveHammers(db, saver, 1000, daysAgo(weekStart - DAY));
    await saveHammers(db, saver, 3000, daysAgo(weekStart + 3 * DAY));
    await saveHammers(db, spender, 5000, daysAgo(weekStart - DAY));
    await saveHammers(db, spender, 500, daysAgo(weekStart + 3 * DAY));
    await saveHammers(db, quiet, 800, daysAgo(weekStart - DAY));
    const report = await warSpending(admin, week, db);
    const row = (name: string) => report.rows.find(({ member }) => member.username === name)!;
    assert.equal(report.week, week);
    assert.equal(row("Saver").spent, (1000 - 3000) * 2);
    assert.equal(row("Spender").spent, (5000 - 500) * 2);
    assert.equal(row("Quiet").after, null);
    assert.equal(row("Quiet").spent, null);
    await assert.rejects(warSpending(saver, week, db), apiFailure("ADMIN_REQUIRED"));
  });
});
