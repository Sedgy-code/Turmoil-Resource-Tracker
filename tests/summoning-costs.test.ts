import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  EMPTY_RESOURCES,
  EMPTY_SUMMONING_COSTS,
  type ResourceValues,
} from "../src/lib/resources";
import type { Member } from "../src/lib/types";
import {
  initializeSchema,
  openDatabase,
  type Database,
} from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { entryFromRow, memberFromRow } from "../src/lib/server/mappers";
import {
  copyPreviousEntry,
  dashboard,
  saveEntry,
  updateMember,
} from "../src/lib/server/tracker";
import {
  saveResourcesSchema,
  summoningCostsSchema,
} from "../src/lib/server/validation";

const WEEK = "2026-10-05";
const NEXT_WEEK = "2026-10-12";
const inventory = (values: Partial<ResourceValues> = {}): ResourceValues => ({
  ...EMPTY_RESOURCES,
  ...values,
});
const apiFailure = (code: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code;

async function withDatabase(work: (db: Database) => Promise<void>) {
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

test("summoning costs accept whole numbers from zero through one billion", () => {
  assert.deepEqual(summoningCostsSchema.parse({ fiveSkills: 0, mount: 0 }), EMPTY_SUMMONING_COSTS);
  for (const suppliedCosts of [{}, { fiveSkills: 0 }, { mount: 0 }]) {
    assert.equal(summoningCostsSchema.safeParse(suppliedCosts).success, false);
    assert.equal(saveResourcesSchema.safeParse({
      week: WEEK,
      resources: {},
      summoningCosts: suppliedCosts,
    }).success, false);
  }
  assert.deepEqual(
    summoningCostsSchema.parse({ fiveSkills: 1_000_000_000, mount: 1_000_000_000 }),
    { fiveSkills: 1_000_000_000, mount: 1_000_000_000 },
  );
  for (const key of ["fiveSkills", "mount"]) {
    for (const value of [-1, 0.5, NaN, Infinity, -Infinity, "", " ", "10", null, 1_000_000_001]) {
      assert.equal(summoningCostsSchema.safeParse({ ...EMPTY_SUMMONING_COSTS, [key]: value }).success, false);
    }
  }
  assert.equal(
    summoningCostsSchema.safeParse({ fiveSkills: 5, mount: 1, skillTickets: 10 }).success,
    false,
  );
  const oldClient = saveResourcesSchema.parse({ week: WEEK, resources: {} });
  assert.equal(oldClient.summoningCosts, undefined);
  const explicitZero = saveResourcesSchema.parse({
    week: WEEK,
    resources: {},
    summoningCosts: { fiveSkills: 0, mount: 0 },
  });
  assert.deepEqual(explicitZero.summoningCosts, EMPTY_SUMMONING_COSTS);
});

test("new entries default costs to zero and older-client saves preserve stored costs", async () => {
  await withDatabase(async (db) => {
    const member = await addMember(db, "Kael");
    const initial = await saveEntry(member, {
      week: WEEK,
      resources: inventory({ skillTickets: 100, mountKeys: 20 }),
      notes: "Initial inventory",
    }, db);
    assert.deepEqual(initial.summoningCosts, EMPTY_SUMMONING_COSTS);
    const priced = await saveEntry(member, {
      week: WEEK,
      resources: initial.resources,
      summoningCosts: { fiveSkills: 50, mount: 2 },
      notes: "Costs supplied",
    }, db);
    const oldClient = await saveEntry(member, {
      week: WEEK,
      resources: inventory({ skillTickets: 200, mountKeys: 30 }),
      notes: "Inventory updated by an older client",
    }, db);
    assert.equal(oldClient.id, priced.id);
    assert.deepEqual(oldClient.summoningCosts, { fiveSkills: 50, mount: 2 });
    const cleared = await saveEntry(member, {
      week: WEEK,
      resources: oldClient.resources,
      summoningCosts: { fiveSkills: 0, mount: 0 },
      notes: oldClient.notes,
    }, db);
    assert.deepEqual(cleared.summoningCosts, EMPTY_SUMMONING_COSTS);
    assert.deepEqual(cleared.resources, oldClient.resources);
    const saved = await db.query("SELECT summoning_costs FROM resource_entries WHERE id = $1", [cleared.id]);
    assert.deepEqual(saved[0].summoning_costs, { fiveSkills: 0, mount: 0 });
  });
});

test("costs persist per week, and copying includes both costs without changing history", async () => {
  await withDatabase(async (db) => {
    const member = await addMember(db, "Nyx");
    const original = await saveEntry(member, {
      week: WEEK,
      resources: inventory({ skillTickets: 500, mountKeys: 40 }),
      summoningCosts: { fiveSkills: 50, mount: 4 },
      notes: "Ready for the clan event",
    }, db);
    const copied = await copyPreviousEntry(member, { week: NEXT_WEEK }, db);
    assert.notEqual(copied.id, original.id);
    assert.deepEqual(copied.summoningCosts, original.summoningCosts);
    assert.deepEqual(copied.resources, original.resources);
    assert.equal(copied.notes, original.notes);
    await saveEntry(member, {
      week: NEXT_WEEK,
      resources: copied.resources,
      summoningCosts: { fiveSkills: 100, mount: 8 },
      notes: "Next week's new prices",
    }, db);
    const earlier = await dashboard(member, WEEK, db);
    const later = await dashboard(member, NEXT_WEEK, db);
    assert.deepEqual(earlier.entries[0].summoningCosts, { fiveSkills: 50, mount: 4 });
    assert.deepEqual(later.entries[0].summoningCosts, { fiveSkills: 100, mount: 8 });
    assert.equal(earlier.summons.skills, 50);
    assert.equal(later.summons.skills, 25);
    assert.equal(earlier.summons.mounts, 10);
    assert.equal(later.summons.mounts, 5);
  });
});

test("summoning costs use the same ownership, admin, and active-member permissions as inventory", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const member = await addMember(db, "Member");
    const resources = inventory({ skillTickets: 100 });
    await assert.rejects(saveEntry(member, {
      week: WEEK,
      memberId: admin.id,
      resources,
      summoningCosts: { fiveSkills: 10, mount: 1 },
      notes: "Forbidden",
    }, db), apiFailure("FORBIDDEN"));
    const own = await saveEntry(member, {
      week: WEEK,
      resources,
      summoningCosts: { fiveSkills: 20, mount: 2 },
      notes: "My prices",
    }, db);
    const edited = await saveEntry(admin, {
      week: WEEK,
      memberId: member.id,
      resources,
      summoningCosts: { fiveSkills: 25, mount: 5 },
      notes: "Admin correction",
    }, db);
    assert.equal(edited.id, own.id);
    assert.equal(edited.updatedBy.id, admin.id);
    assert.deepEqual(edited.summoningCosts, { fiveSkills: 25, mount: 5 });
    await updateMember(admin, member.id, { active: false }, db);
    await assert.rejects(saveEntry(member, {
      week: WEEK,
      resources,
      summoningCosts: EMPTY_SUMMONING_COSTS,
      notes: "Stale member write",
    }, db), apiFailure("ACCOUNT_INACTIVE"));
    await assert.rejects(saveEntry(admin, {
      week: WEEK,
      memberId: member.id,
      resources,
      summoningCosts: EMPTY_SUMMONING_COSTS,
      notes: "Inactive target",
    }, db), apiFailure("MEMBER_NOT_FOUND"));
    await assert.rejects(copyPreviousEntry(member, { week: NEXT_WEEK }, db), apiFailure("ACCOUNT_INACTIVE"));
  });
});

test("summon totals use each active member's selected-week prices and count only positive missing inventory", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const first = await addMember(db, "First");
    const second = await addMember(db, "Second");
    const ticketsMissing = await addMember(db, "Ticket prices missing");
    const mountsMissing = await addMember(db, "Mount prices missing");
    const empty = await addMember(db, "No inventory");
    const inactive = await addMember(db, "Inactive");
    const fixtures = [
      { member: first, tickets: 500, keys: 40, skillCost: 50, mountCost: 4 },
      { member: second, tickets: 600, keys: 30, skillCost: 100, mountCost: 5 },
      { member: ticketsMissing, tickets: 100, keys: 0, skillCost: 0, mountCost: 0 },
      { member: mountsMissing, tickets: 0, keys: 10, skillCost: 0, mountCost: 0 },
      { member: empty, tickets: 0, keys: 0, skillCost: 0, mountCost: 0 },
      { member: inactive, tickets: 10_000, keys: 10_000, skillCost: 1, mountCost: 1 },
    ];
    for (const fixture of fixtures) {
      await saveEntry(fixture.member, {
        week: WEEK,
        resources: inventory({ skillTickets: fixture.tickets, mountKeys: fixture.keys }),
        summoningCosts: { fiveSkills: fixture.skillCost, mount: fixture.mountCost },
        notes: "",
      }, db);
    }
    await saveEntry(first, {
      week: NEXT_WEEK,
      resources: inventory({ skillTickets: 10_000, mountKeys: 10_000 }),
      summoningCosts: { fiveSkills: 1, mount: 1 },
      notes: "Different week must not leak into totals",
    }, db);
    await updateMember(admin, inactive.id, { active: false }, db);
    const result = await dashboard(admin, WEEK, db);
    assert.deepEqual(result.summons, {
      skills: 80,
      mounts: 16,
      missingSkillCosts: 1,
      missingMountCosts: 1,
    });
    assert.equal(result.totals.skillTickets, 1200);
    assert.equal(result.totals.mountKeys, 80);
    assert.equal(result.entries.length, 5);
    const emptyWeek = await dashboard(admin, "2026-09-28", db);
    assert.deepEqual(emptyWeek.summons, { skills: 0, mounts: 0, missingSkillCosts: 0, missingMountCosts: 0 });
  });
});

test("migration adds costs to a prior database idempotently while preserving inventory and update history", async () => {
  const db = await openDatabase();
  try {
    await db.query(`CREATE TABLE app_members (
      id TEXT PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
      avatar_url TEXT, role TEXT NOT NULL DEFAULT 'MEMBER', active BOOLEAN NOT NULL DEFAULT TRUE,
      last_updated_at TIMESTAMPTZ, joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE resource_entries (
      id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES app_members(id),
      week_start DATE NOT NULL, resources JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT NOT NULL REFERENCES app_members(id), UNIQUE(member_id,week_start)
    )`);
    const member = await addMember(db, "Legacy", "ADMIN");
    const entryId = randomUUID();
    const historyTime = "2026-10-05T01:23:45.000Z";
    const resources = inventory({ skillTickets: 100, mountKeys: 12, potions: 7 });
    await db.query("UPDATE app_members SET last_updated_at = $2 WHERE id = $1", [member.id, historyTime]);
    await db.query("INSERT INTO resource_entries (id,member_id,week_start,resources,notes,updated_at,updated_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$2)", [entryId, member.id, WEEK, JSON.stringify(resources), "Legacy notes must survive", historyTime]);
    const before = (await db.query("SELECT * FROM resource_entries WHERE id = $1", [entryId]))[0];
    const memberBefore = (await db.query("SELECT last_updated_at FROM app_members WHERE id = $1", [member.id]))[0];
    await initializeSchema(db);
    await initializeSchema(db);
    const after = (await db.query("SELECT * FROM resource_entries WHERE id = $1", [entryId]))[0];
    const { summoning_costs: migratedCosts, ...preservedFields } = after;
    assert.deepEqual(preservedFields, before);
    assert.deepEqual(migratedCosts, {});
    assert.deepEqual(entryFromRow(after).summoningCosts, EMPTY_SUMMONING_COSTS);
    assert.deepEqual(entryFromRow(after).resources, resources);
    assert.equal(entryFromRow(after).notes, "Legacy notes must survive");
    assert.equal(entryFromRow(after).updatedAt, historyTime);
    assert.deepEqual((await db.query("SELECT last_updated_at FROM app_members WHERE id = $1", [member.id]))[0], memberBefore);
    const result = await dashboard(member, WEEK, db);
    assert.deepEqual(result.summons, { skills: 0, mounts: 0, missingSkillCosts: 1, missingMountCosts: 1 });
  } finally {
    await db.close();
  }
});

test("exact member summons are added before rounding clan totals down, up, or halfway up", async () => {
  await withDatabase(async (db) => {
    const first = await addMember(db, "First");
    const second = await addMember(db, "Second");
    await saveEntry(first, {
      week: WEEK,
      resources: inventory({ skillTickets: 10, mountKeys: 5 }),
      summoningCosts: { fiveSkills: 3, mount: 2 },
      notes: "",
    }, db);
    await saveEntry(second, {
      week: WEEK,
      resources: inventory({ skillTickets: 5, mountKeys: 5 }),
      summoningCosts: { fiveSkills: 2, mount: 3 },
      notes: "",
    }, db);
    const result = await dashboard(first, WEEK, db);
    // Exact sums are 29.166... skills and 4.166... mounts. Rounding each member
    // first would give 30 and 5, while flooring each member gives 28 and 3.
    assert.deepEqual(result.summons, {
      skills: 29,
      mounts: 4,
      missingSkillCosts: 0,
      missingMountCosts: 0,
    });
    await saveEntry(first, {
      week: NEXT_WEEK,
      resources: inventory({ skillTickets: 10, mountKeys: 5 }),
      summoningCosts: { fiveSkills: 3, mount: 2 },
      notes: "",
    }, db);
    await saveEntry(second, {
      week: NEXT_WEEK,
      resources: inventory({ skillTickets: 13, mountKeys: 7 }),
      summoningCosts: { fiveSkills: 5, mount: 3 },
      notes: "",
    }, db);
    const roundsUp = await dashboard(first, NEXT_WEEK, db);
    assert.equal(roundsUp.summons.skills, 30);
    assert.equal(roundsUp.summons.mounts, 5);
    await saveEntry(first, {
      week: "2026-10-19",
      resources: inventory({ skillTickets: 5, mountKeys: 5 }),
      summoningCosts: { fiveSkills: 2, mount: 2 },
      notes: "Halfway results round up",
    }, db);
    const halfway = await dashboard(first, "2026-10-19", db);
    assert.equal(halfway.summons.skills, 13);
    assert.equal(halfway.summons.mounts, 3);
    await saveEntry(first, {
      week: "2026-10-26",
      resources: inventory({ skillTickets: 21, mountKeys: 0 }),
      summoningCosts: { fiveSkills: 5, mount: 0 },
      notes: "Exact whole skill total",
    }, db);
    assert.equal((await dashboard(first, "2026-10-26", db)).summons.skills, 21);
  });
});
