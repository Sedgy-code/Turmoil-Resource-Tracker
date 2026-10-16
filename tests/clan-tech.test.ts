import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { TECH_NODES, nextToFund, progress } from "../src/lib/clan-tech";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { loadClanTech, saveClanTech } from "../src/lib/server/clan-tech";
import { memberFromRow } from "../src/lib/server/mappers";

test("war point nodes come first, then war battle, then race boosts", () => {
  const next = nextToFund({}, 30);
  assert.equal(next[0].priority, 1);
  assert.ok(next.findIndex((entry) => entry.key === "clan-war-damage") >= next.filter((entry) => entry.priority === 1).length);
  const allWarPoints = Object.fromEntries(TECH_NODES.filter((entry) => entry.priority === 1).map((entry) => [entry.key, entry.max]));
  assert.equal(nextToFund(allWarPoints)[0].priority, 2);
  assert.equal(new Set(TECH_NODES.map((entry) => entry.key)).size, TECH_NODES.length);
  assert.equal(progress({}), 0);
});

let db: Database;
const adminId = randomUUID();
const memberId = randomUUID();
before(async () => {
  db = await openDatabase();
  await initializeSchema(db);
  await db.query("INSERT INTO app_members (id, discord_id, username, role) VALUES ($1, '1', 'boss', 'ADMIN'), ($2, '2', 'sam', 'MEMBER')", [adminId, memberId]);
});
after(async () => { await db.close(); });
const load = async (id: string) => memberFromRow((await db.query("SELECT * FROM app_members WHERE id = $1", [id]))[0]);

test("admins save levels (capped at max), members can only look, reset zeros everything", async () => {
  const saved = await saveClanTech(await load(adminId), { levels: { "war-points-on-day-1": 7, "auto-forge": 9 } }, db);
  assert.equal(saved.levels["war-points-on-day-1"], 7);
  assert.equal(saved.levels["auto-forge"], 2);
  const seen = await loadClanTech(await load(memberId), db);
  assert.equal(seen.canEdit, false);
  assert.equal(seen.levels["war-points-on-day-1"], 7);
  await assert.rejects(saveClanTech(await load(memberId), { levels: { "auto-forge": 1 } }, db));
  const reset = await saveClanTech(await load(adminId), { reset: true }, db);
  assert.equal(reset.levels["war-points-on-day-1"], 0);
});
