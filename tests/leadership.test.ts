import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { applyLeadershipAction, memberHistory } from "../src/lib/server/leadership";
import { listMembers } from "../src/lib/server/tracker";
import { membersWithoutWeeklyUpdate } from "../src/lib/server/reminders";
import { memberFromRow } from "../src/lib/server/mappers";
import { toCsv } from "../src/lib/csv";

let db: Database;
const adminId = randomUUID();
const memberId = randomUUID();
before(async () => {
  db = await openDatabase();
  await initializeSchema(db);
  await db.query("INSERT INTO app_members (id, discord_id, username, role) VALUES ($1, '1', 'boss', 'ADMIN'), ($2, '2', 'sam', 'MEMBER')", [adminId, memberId]);
});
after(async () => { await db.close(); });

const admin = async () => memberFromRow((await db.query("SELECT * FROM app_members WHERE id = $1", [adminId]))[0]);

test("strikes are counted, logged and removable", async () => {
  const actor = await admin();
  const updated = await applyLeadershipAction(actor, memberId, { action: "strike", reason: "Missed war" }, db);
  assert.equal(updated.strikes, 1);
  const listed = (await listMembers(actor, db)).find((member) => member.id === memberId);
  assert.equal(listed?.strikes, 1);
  const history = await memberHistory(actor, memberId, db);
  assert.equal(history.strikes.length, 1);
  assert.ok(history.events.some((event) => event.kind === "strike" && event.text === "Missed war"));
  const removed = await applyLeadershipAction(actor, memberId, { action: "remove-strike", strikeId: history.strikes[0].id }, db);
  assert.equal(removed.strikes, 0);
  assert.ok((await memberHistory(actor, memberId, db)).events.some((event) => event.kind === "strike-removed"));
});

test("members on holiday skip the weekly reminder", async () => {
  const actor = await admin();
  const before = await membersWithoutWeeklyUpdate(db);
  assert.ok(before.some((member) => member.name === "sam"));
  const away = await applyLeadershipAction(actor, memberId, { action: "holiday", until: "2099-01-01" }, db);
  assert.equal(away.holidayUntil, "2099-01-01");
  assert.ok(!(await membersWithoutWeeklyUpdate(db)).some((member) => member.name === "sam"));
  await applyLeadershipAction(actor, memberId, { action: "holiday", until: null }, db);
  assert.ok((await membersWithoutWeeklyUpdate(db)).some((member) => member.name === "sam"));
});

test("only admins can give strikes", async () => {
  const member = memberFromRow((await db.query("SELECT * FROM app_members WHERE id = $1", [memberId]))[0]);
  await assert.rejects(applyLeadershipAction(member, adminId, { action: "strike", reason: "x" }, db));
});

test("CSV cells are escaped and formulas neutralised", () => {
  assert.equal(toCsv([["a,b", 'say "hi"', "=SUM(A1)", -5, null]]), '"a,b","say ""hi""",\'=SUM(A1),-5,\r\n');
});
