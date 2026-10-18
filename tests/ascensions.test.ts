import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Member } from "../src/lib/types";
import { getAscensions, parsePillars, setAscension } from "../src/lib/server/ascensions";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import { ascensionSchema } from "../src/lib/server/validation";

const SUNDAY = new Date("2026-10-18T10:00:00Z"); // clan week of Monday 12 October
const MONDAY = new Date("2026-10-19T10:00:00Z"); // a new clan week starts

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
  try { await initializeSchema(db); await work(db); } finally { await db.close(); }
}
async function addMember(db: Database, username: string): Promise<Member> {
  const rows = await db.query("INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,$2,$3,'MEMBER') RETURNING *", [randomUUID(), randomUUID(), username]);
  return memberFromRow(rows[0]);
}

test("members say each week whether they're ascending, and what", async () => {
  await withDatabase(async (db) => {
    const kael = await addMember(db, "Kael");
    const mira = await addMember(db, "Mira");
    const zed = await addMember(db, "Zed");
    // Nobody has answered yet.
    assert.deepEqual(await getAscensions(kael, "2026-10-12", db), { week: "2026-10-12", mine: null, ascending: [] });
    // Kael ascends pets and skills (always stored in the same order), Mira isn't ascending.
    const saved = await setAscension(kael, ["pets", "skills"], db, SUNDAY);
    assert.deepEqual(saved.mine, ["skills", "pets"]);
    await setAscension(mira, [], db, SUNDAY);
    const seenByZed = await getAscensions(zed, "2026-10-12", db);
    assert.equal(seenByZed.mine, null);
    assert.deepEqual(seenByZed.ascending, [{ memberId: kael.id, pillars: ["skills", "pets"] }]);
    assert.deepEqual((await getAscensions(mira, "2026-10-12", db)).mine, []);
    // Changing an answer replaces it.
    await setAscension(kael, ["forge"], db, SUNDAY);
    assert.deepEqual((await getAscensions(zed, "2026-10-12", db)).ascending, [{ memberId: kael.id, pillars: ["forge"] }]);
    // A new week starts with no answers.
    await setAscension(kael, ["mounts"], db, MONDAY);
    assert.deepEqual((await getAscensions(kael, "2026-10-19", db)).mine, ["mounts"]);
    assert.deepEqual((await getAscensions(kael, "2026-10-12", db)).mine, ["forge"]);
    // Members who left aren't listed.
    await db.query("UPDATE app_members SET active = FALSE WHERE id = $1", [kael.id]);
    assert.deepEqual((await getAscensions(zed, "2026-10-12", db)).ascending, []);
    await assert.rejects(setAscension(kael, ["skills"], db, SUNDAY), (error) => error instanceof ApiError && error.code === "ACCOUNT_INACTIVE");
  });
});

test("only the four pillars can be sent", () => {
  assert.deepEqual(ascensionSchema.parse({ pillars: ["skills", "pets"] }).pillars, ["skills", "pets"]);
  assert.deepEqual(ascensionSchema.parse({ pillars: [] }).pillars, []);
  assert.throws(() => ascensionSchema.parse({ pillars: ["gear"] }));
  assert.throws(() => ascensionSchema.parse({ pillars: ["skills"], extra: true }));
  assert.deepEqual(parsePillars("pets,bogus,forge"), ["forge", "pets"]);
});
