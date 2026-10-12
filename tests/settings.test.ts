import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { memberFromRow } from "../src/lib/server/mappers";
import { getSettings, updateSettings } from "../src/lib/server/settings";
import { ApiError } from "../src/lib/server/errors";
import { createSnipeSchema, saveBankSchema, settingsSchema } from "../src/lib/server/validation";
import { DEFAULT_WAR_RATES } from "../src/lib/war";

async function withAdmin(work: (db: Database, admin: ReturnType<typeof memberFromRow>) => Promise<void>) {
  const db = await openDatabase();
  try {
    await initializeSchema(db);
    const rows = await db.query("INSERT INTO app_members(id,discord_id,username,role) VALUES($1,$2,'Leader','ADMIN') RETURNING *", [randomUUID(), randomUUID()]);
    await work(db, memberFromRow(rows[0]));
  } finally { await db.close(); }
}

test("clan settings persist partial updates without resetting other saved settings", async () => {
  await withAdmin(async (db, admin) => {
    assert.deepEqual(await getSettings(admin, db), { capacity: 50, warRates: DEFAULT_WAR_RATES });
    await updateSettings(admin, { capacity: 45 }, db);
    const rates = { ...DEFAULT_WAR_RATES, mountSummons: 1200 };
    assert.deepEqual(await updateSettings(admin, { warRates: rates }, db), { capacity: 45, warRates: rates });
    assert.deepEqual(await getSettings(admin, db), { capacity: 45, warRates: rates });
  });
});

test("clan setting writes reject stale administrator roles and inactive accounts", async () => {
  await withAdmin(async (db, admin) => {
    await db.query("UPDATE app_members SET role='MEMBER' WHERE id=$1", [admin.id]);
    await assert.rejects(updateSettings(admin, { capacity: 80 }, db), error => error instanceof ApiError && error.code === "ADMIN_REQUIRED");
    await db.query("UPDATE app_members SET role='ADMIN',active=FALSE WHERE id=$1", [admin.id]);
    await assert.rejects(updateSettings(admin, { capacity: 80 }, db), error => error instanceof ApiError && error.code === "ACCOUNT_INACTIVE");
    assert.equal((await getSettings(undefined, db)).capacity, 50);
  });
});

test("planning requests reject invalid rates, reversed hammer ranges, unknown fields and repeated activities", () => {
  for (const capacity of [0, -1, 1.5, 1001, "50"]) assert.equal(settingsSchema.safeParse({ capacity }).success, false);
  assert.equal(settingsSchema.safeParse({ warRates: { ...DEFAULT_WAR_RATES, hammersMin: 6, hammersMax: 5 } }).success, false);
  assert.equal(settingsSchema.safeParse({ warRates: { ...DEFAULT_WAR_RATES, eggMerges: Infinity } }).success, false);
  assert.equal(settingsSchema.safeParse({ capacity: 50, unknown: true }).success, false);
  assert.equal(settingsSchema.safeParse({}).success, false);
  assert.equal(createSnipeSchema.safeParse({ title: "Event", startsAt: "2027-01-01T00:00:00Z", activities: ["hammers", "hammers"] }).success, false);
  assert.equal(createSnipeSchema.safeParse({ title: "Event", startsAt: "invalid", activities: ["hammers"] }).success, false);
  assert.equal(saveBankSchema.safeParse({ resources: {}, planningDetails: { skillLevel: 1, mountLevel: 1, eggLevel: 1, newMountMerges: 1, eggMerges: 1_000_001, eggSummonMerges: 1 }, notes: "" }).success, false);
});
