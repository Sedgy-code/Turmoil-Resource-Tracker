import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  EMPTY_RESOURCES,
  RESOURCE_FIELDS,
  type ResourceValues,
} from "../src/lib/resources";
import type { Member } from "../src/lib/types";
import {
  initializeSchema,
  openDatabase,
  type Database,
} from "../src/lib/server/db";
import { entryFromRow, memberFromRow } from "../src/lib/server/mappers";
import {
  copyPreviousEntry,
  dashboard,
  saveEntry,
  updateMember,
} from "../src/lib/server/tracker";
import {
  resourceSchema,
  saveResourcesSchema,
} from "../src/lib/server/validation";

const WEEK = "2026-10-05";
const NEXT_WEEK = "2026-10-12";
const CURRENT_KEYS = [
  "skillTickets",
  "eggsPetsTotal",
  "mountKeys",
  "mountsToMerge",
  "hammers",
];
const LEGACY = {
  eggsCommon: 1,
  eggsRare: 2,
  eggsEpic: 3,
  eggsLegendary: 4,
  eggsUltimate: 5,
  eggsMythic: 6,
  petsCommon: 7,
  petsRare: 8,
  petsEpic: 9,
  petsLegendary: 10,
  petsUltimate: 11,
  petsMythic: 12,
};
const canonical = (values: Partial<ResourceValues> = {}): ResourceValues => ({
  ...EMPTY_RESOURCES,
  ...values,
});

function assertCurrentKeys(values: object): void {
  assert.deepEqual(Object.keys(values).sort(), [...CURRENT_KEYS].sort());
}

async function withDatabase(work: (db: Database) => Promise<void>): Promise<void> {
  const db = await openDatabase();
  try {
    await initializeSchema(db);
    await work(db);
  } finally {
    await db.close();
  }
}

async function addMember(
  db: Database,
  username: string,
  role: Member["role"] = "MEMBER",
): Promise<Member> {
  const rows = await db.query(
    "INSERT INTO app_members (id,discord_id,username,role) VALUES ($1,$2,$3,$4) RETURNING *",
    [randomUUID(), `test-${randomUUID()}`, username, role],
  );
  return memberFromRow(rows[0]);
}

async function insertLegacy(
  db: Database,
  member: Member,
  week: string,
  resources: object,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO resource_entries
    (id,member_id,week_start,resources,notes,updated_at,updated_by,summoning_costs)
    VALUES ($1,$2,$3,$4::jsonb,$5,$6,$2,$7::jsonb)`,
    [
      id,
      member.id,
      week,
      JSON.stringify(resources),
      "Saved before the combined field",
      "2026-10-05T01:23:45Z",
      JSON.stringify({ fiveSkills: 8, mount: 2 }),
    ],
  );
  return id;
}

test("resource responses expose five fields with one combined eggs and pets total", () => {
  assert.deepEqual(RESOURCE_FIELDS.map(({ key }) => key).sort(), [...CURRENT_KEYS].sort());
  const parsed = resourceSchema.parse({});
  assertCurrentKeys(parsed);
  assert.deepEqual(parsed, canonical());
  assert.deepEqual(
    resourceSchema.parse({ eggsPetsTotal: 23, skillTickets: 5 }),
    canonical({ eggsPetsTotal: 23, skillTickets: 5 }),
  );
});

test("legacy requests sum all twelve rarities while explicit combined zero overrides them", () => {
  const parsed = resourceSchema.parse({ ...LEGACY, hammers: 19 });
  assertCurrentKeys(parsed);
  assert.deepEqual(parsed, canonical({ eggsPetsTotal: 78, hammers: 19 }));
  assert.equal(
    resourceSchema.parse({ eggsCommon: 3, petsMythic: 4 }).eggsPetsTotal,
    7,
  );
  for (const eggsPetsTotal of [0, 9]) {
    assert.deepEqual(
      resourceSchema.parse({ ...LEGACY, eggsPetsTotal }),
      canonical({ eggsPetsTotal }),
    );
  }
  const maximumLegacy = Object.fromEntries(
    Object.keys(LEGACY).map((key) => [key, 1_000_000_000]),
  );
  assert.equal(resourceSchema.parse(maximumLegacy).eggsPetsTotal, 12_000_000_000);
});

test("combined and legacy request values reject invalid types and respect their numeric bounds", () => {
  const invalid = [-1, 0.5, NaN, Infinity, -Infinity, "9", null];
  for (const key of CURRENT_KEYS) {
    const maximum = key === "eggsPetsTotal" ? 12_000_000_000 : 1_000_000_000;
    for (const value of [0, maximum]) {
      assert.equal(resourceSchema.safeParse({ [key]: value }).success, true);
    }
    for (const value of [...invalid, maximum + 1]) {
      assert.equal(resourceSchema.safeParse({ [key]: value }).success, false);
    }
  }
  for (const key of Object.keys(LEGACY)) {
    for (const value of [...invalid, 1_000_000_001]) {
      // Even retired values that an explicit total overrides must be valid.
      assert.equal(
        resourceSchema.safeParse({ eggsPetsTotal: 0, [key]: value }).success,
        false,
      );
    }
  }
  assert.equal(resourceSchema.safeParse({ eggsPetsTotal: 1, unknown: 2 }).success, false);
  assert.equal(resourceSchema.safeParse(null).success, false);
  assert.equal(resourceSchema.safeParse("12").success, false);
});

test("retired potion requests are validated and omitted while unknown resources remain rejected", () => {
  for (const potions of [0, 44, 1_000_000_000]) {
    const parsed = resourceSchema.parse({ eggsPetsTotal: 23, hammers: 19, potions });
    assertCurrentKeys(parsed);
    assert.deepEqual(parsed, canonical({ eggsPetsTotal: 23, hammers: 19 }));
  }
  for (const potions of [-1, 0.5, NaN, Infinity, "44", null, 1_000_000_001]) {
    assert.equal(resourceSchema.safeParse({ potions }).success, false);
  }
  assert.equal(resourceSchema.safeParse({ potions: 44, unknown: 1 }).success, false);
});

test("legacy row mapping returns only combined fields for JSON objects and serialized JSON", () => {
  const legacy = { ...LEGACY, skillTickets: 21, mountKeys: 6, potions: 44, ignoredOldMetadata: 44 };
  const snapshot = structuredClone(legacy);
  const row = {
    id: randomUUID(),
    member_id: randomUUID(),
    week_start: WEEK,
    notes: "Historic inventory",
    updated_at: "2026-10-05T01:23:45Z",
    updated_by: randomUUID(),
    updated_by_username: "Member",
  };
  for (const resources of [legacy, JSON.stringify(legacy)]) {
    const entry = entryFromRow({ ...row, resources });
    assertCurrentKeys(entry.resources);
    assert.deepEqual(
      entry.resources,
      canonical({ eggsPetsTotal: 78, skillTickets: 21, mountKeys: 6 }),
    );
    assert.equal(entry.week, WEEK);
    assert.deepEqual(entry.summoningCosts, { fiveSkills: 0, mount: 0 });
  }
  for (const eggsPetsTotal of [0, 17]) {
    assert.equal(
      entryFromRow({ ...row, resources: { ...legacy, eggsPetsTotal } }).resources.eggsPetsTotal,
      eggsPetsTotal,
    );
  }
  assert.deepEqual(legacy, snapshot);
});

test("legacy weekly rows aggregate independently and retain their original stored JSON", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const first = await addMember(db, "First");
    const second = await addMember(db, "Second");
    const inactive = await addMember(db, "Inactive");
    const legacyId = await insertLegacy(db, first, WEEK, { ...LEGACY, skillTickets: 21 });
    await insertLegacy(db, second, WEEK, { eggsCommon: 5 });
    await insertLegacy(db, inactive, WEEK, { petsMythic: 500 });
    await insertLegacy(db, first, NEXT_WEEK, { ...LEGACY, eggsPetsTotal: 900 });
    const before = await db.query("SELECT * FROM resource_entries WHERE id=$1", [legacyId]);
    await updateMember(admin, inactive.id, { active: false }, db);

    const earlier = await dashboard(admin, WEEK, db);
    assert.equal(earlier.totals.eggsPetsTotal, 83);
    assert.equal(earlier.entries.length, 2);
    assert.equal(earlier.totals.skillTickets, 21);
    assertCurrentKeys(earlier.totals);
    earlier.entries.forEach((entry) => assertCurrentKeys(entry.resources));
    const later = await dashboard(admin, NEXT_WEEK, db);
    assert.equal(later.totals.eggsPetsTotal, 900);
    assert.equal(later.entries.length, 1);
    assert.equal(later.totals.skillTickets, 0);
    assert.deepEqual(await db.query("SELECT * FROM resource_entries WHERE id=$1", [legacyId]), before);
  });
});

test("copying and editing legacy inventory writes the current shape without changing earlier weeks", async () => {
  await withDatabase(async (db) => {
    const member = await addMember(db, "Member");
    const legacyId = await insertLegacy(db, member, WEEK, { ...LEGACY, skillTickets: 21 });
    const before = await db.query("SELECT * FROM resource_entries WHERE id=$1", [legacyId]);
    const copied = await copyPreviousEntry(member, { week: NEXT_WEEK }, db);
    assert.equal(copied.resources.eggsPetsTotal, 78);
    assert.equal(copied.notes, "Saved before the combined field");
    assert.deepEqual(copied.summoningCosts, { fiveSkills: 8, mount: 2 });
    const storedCopy = await db.query("SELECT resources FROM resource_entries WHERE id=$1", [copied.id]);
    assertCurrentKeys(storedCopy[0].resources as object);
    assert.deepEqual(storedCopy[0].resources, copied.resources);

    // Exercise the same validation boundary as an older browser's PUT payload.
    const oldClient = saveResourcesSchema.parse({
      week: NEXT_WEEK,
      resources: { ...LEGACY, petsMythic: 20, hammers: 10 },
      notes: "An older browser updated this week",
    });
    const compatible = await saveEntry(member, oldClient, db);
    assert.equal(compatible.id, copied.id);
    assert.equal(compatible.resources.eggsPetsTotal, 86);
    assert.equal(compatible.resources.hammers, 10);
    assert.deepEqual(compatible.summoningCosts, copied.summoningCosts);

    const explicitZero = await saveEntry(member, {
      week: NEXT_WEEK,
      resources: canonical({ eggsPetsTotal: 0, hammers: 11 }),
      notes: "Combined inventory cleared",
    }, db);
    assert.equal(explicitZero.resources.eggsPetsTotal, 0);
    const stored = await db.query("SELECT resources FROM resource_entries WHERE id=$1", [copied.id]);
    assertCurrentKeys(stored[0].resources as object);
    assert.equal((stored[0].resources as ResourceValues).eggsPetsTotal, 0);
    assert.equal((await dashboard(member, WEEK, db)).totals.eggsPetsTotal, 78);
    assert.equal((await dashboard(member, NEXT_WEEK, db)).totals.eggsPetsTotal, 0);
    assert.deepEqual(await db.query("SELECT * FROM resource_entries WHERE id=$1", [legacyId]), before);
  });
});

test("retired potions disappear from reads and new writes without changing historical stored inventory", async () => {
  await withDatabase(async (db) => {
    const member = await addMember(db, "Member");
    const historicResources = { ...canonical({ eggsPetsTotal: 23, hammers: 19 }), potions: 44 };
    const historicId = await insertLegacy(db, member, WEEK, historicResources);
    const before = await db.query("SELECT * FROM resource_entries WHERE id=$1", [historicId]);

    await initializeSchema(db);
    const result = await dashboard(member, WEEK, db);
    assertCurrentKeys(result.totals);
    assert.deepEqual(result.entries[0].resources, canonical({ eggsPetsTotal: 23, hammers: 19 }));
    assert.deepEqual(result.totals, canonical({ eggsPetsTotal: 23, hammers: 19 }));

    const copied = await copyPreviousEntry(member, { week: NEXT_WEEK }, db);
    const storedCopy = await db.query("SELECT resources FROM resource_entries WHERE id=$1", [copied.id]);
    assertCurrentKeys(storedCopy[0].resources as object);
    assert.deepEqual(storedCopy[0].resources, copied.resources);

    const oldClient = saveResourcesSchema.parse({
      week: NEXT_WEEK,
      resources: { ...historicResources, hammers: 20, potions: 99 },
      notes: "Saved from an already open browser",
    });
    const saved = await saveEntry(member, oldClient, db);
    assert.deepEqual(saved.resources, canonical({ eggsPetsTotal: 23, hammers: 20 }));
    const stored = await db.query("SELECT resources FROM resource_entries WHERE id=$1", [saved.id]);
    assertCurrentKeys(stored[0].resources as object);
    assert.deepEqual(stored[0].resources, saved.resources);
    assert.deepEqual(await db.query("SELECT * FROM resource_entries WHERE id=$1", [historicId]), before);
  });
});
