import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  EMPTY_PLANNING_DETAILS,
  EMPTY_RESOURCES,
  EMPTY_SUMMONING_COSTS,
  type PlanningDetails,
  type ResourceValues,
  type SummoningCosts,
} from "../src/lib/resources";
import { DEFAULT_WAR_RATES, estimateWar, WAR_ACTIVITIES, WarEstimateError } from "../src/lib/war";
import { DEW_ITEMS } from "../src/lib/dew";
import type { Member, ResourceEntry, WarActivity } from "../src/lib/types";
import { initializeSchema, openDatabase, type Database } from "../src/lib/server/db";
import { ApiError } from "../src/lib/server/errors";
import { memberFromRow } from "../src/lib/server/mappers";
import {
  awardDewForBankUpdate,
  createSnipe,
  equipDewItem,
  getDew,
  listSnipes,
  purchaseDewItem,
  respondToSnipe,
  snipesToAnswer,
  updateSnipe,
} from "../src/lib/server/planning";

const ALL_ACTIVITIES = WAR_ACTIVITIES.map(({ key }) => key);
const apiFailure = (code: string) => (error: unknown) =>
  error instanceof ApiError && error.code === code;
const inventory = (values: Partial<ResourceValues> = {}): ResourceValues => ({
  ...EMPTY_RESOURCES,
  ...values,
});
const details = (values: Partial<PlanningDetails> = {}): PlanningDetails => ({
  ...EMPTY_PLANNING_DETAILS,
  ...values,
});

function entry(
  values: Partial<ResourceValues>,
  costs: SummoningCosts = { fiveSkills: 150, mount: 40 },
  planning: Partial<PlanningDetails> = {},
): ResourceEntry {
  return {
    id: randomUUID(),
    memberId: randomUUID(),
    week: "2026-10-12",
    resources: inventory(values),
    summoningCosts: costs,
    planningDetails: details(planning),
    notes: "",
    updatedAt: "2026-10-12T01:00:00.000Z",
    updatedBy: { id: randomUUID(), username: "Test member" },
  };
}

async function withDatabase(work: (db: Database) => Promise<void>) {
  const db = await openDatabase({ localPath: "memory://" });
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
    [randomUUID(), `planning-test-${randomUUID()}`, username, role],
  );
  return memberFromRow(rows[0]);
}

async function saveBank(
  db: Database,
  member: Member,
  values: Partial<ResourceValues>,
  planning: Partial<PlanningDetails> = {},
  costs: SummoningCosts = { fiveSkills: 150, mount: 40 },
) {
  await db.query(
    `INSERT INTO member_banks (member_id,resources,summoning_costs,planning_details,notes,updated_by)
     VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,'',$1)
     ON CONFLICT (member_id) DO UPDATE SET resources=EXCLUDED.resources,
       summoning_costs=EXCLUDED.summoning_costs,planning_details=EXCLUDED.planning_details,
       updated_at=NOW(),updated_by=EXCLUDED.updated_by`,
    [member.id, JSON.stringify(inventory(values)), JSON.stringify(costs), JSON.stringify(details(planning))],
  );
}

async function makeSnipe(db: Database, admin: Member, activities: WarActivity[] = ["hammers"]) {
  return createSnipe(admin, {
    title: "Skills night",
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    activities,
  }, db);
}

test("war estimates count affordable summons per member and keep all activities distinct", () => {
  const first = entry(
    { skillTickets: 449, mountKeys: 99, mountsToMerge: 2, hammers: 3, eggsPetsTotal: 10 },
    { fiveSkills: 150, mount: 40 },
    { newMountMerges: 5, eggMerges: 4, eggSummonMerges: 2 },
  );
  const second = entry(
    { skillTickets: 199, mountKeys: 149, mountsToMerge: 3, hammers: 4, eggsPetsTotal: 5 },
    { fiveSkills: 200, mount: 50 },
    { newMountMerges: 1, eggMerges: 1, eggSummonMerges: 3 },
  );
  const result = estimateWar([first, second], DEFAULT_WAR_RATES, ALL_ACTIVITIES, "historical");
  const quantities = Object.fromEntries(result.rows.map((row) => [row.activity, row.quantity]));
  assert.deepEqual(quantities, {
    hammers: 7,
    skillSummons: 18,
    mountSummons: 4,
    newMountMerges: 3,
    mountMerges: 5,
    eggMerges: 5,
    eggSummonMerges: 5,
  });
  assert.equal(result.minimum, 39_524);
  assert.equal(result.maximum, 39_545);
  assert.equal(result.missingCosts, 0);
});

test("war estimates include only selected activities and respect editable scoring rates", () => {
  const bank = entry(
    { hammers: 1_000, mountKeys: 120, eggsPetsTotal: 10 },
    { fiveSkills: 150, mount: 40 },
    { eggMerges: 2, eggSummonMerges: 3 },
  );
  const hammerOnly = estimateWar([bank], DEFAULT_WAR_RATES, ["hammers"]);
  assert.equal(hammerOnly.minimum, 2_000);
  assert.equal(hammerOnly.maximum, 5_000);
  assert.deepEqual(hammerOnly.rows.map((row) => row.activity), ["hammers"]);
  const changed = estimateWar([bank], {
    ...DEFAULT_WAR_RATES,
    mountSummons: 100,
    eggMerges: 20,
    eggSummonMerges: 30,
  }, ["mountSummons", "eggMerges", "eggSummonMerges"], "historical");
  assert.equal(changed.minimum, 430);
  assert.equal(changed.maximum, 430);
  assert.deepEqual(estimateWar([bank], DEFAULT_WAR_RATES, []).rows, []);
  assert.equal(estimateWar([], DEFAULT_WAR_RATES, ALL_ACTIVITIES).maximum, 0);
});

test("missing-cost notices apply only to selected activities with relevant positive inventory", () => {
  const missingBoth = entry(
    { skillTickets: 100, mountKeys: 100 },
    EMPTY_SUMMONING_COSTS,
    { newMountMerges: 2 },
  );
  const unusedMergeCount = entry({ mountKeys: 100 }, EMPTY_SUMMONING_COSTS);
  const empty = entry({}, EMPTY_SUMMONING_COSTS);
  const banks = [missingBoth, unusedMergeCount, empty];
  assert.equal(estimateWar(banks, DEFAULT_WAR_RATES, ALL_ACTIVITIES, "historical").missingCosts, 3);
  assert.equal(estimateWar(banks, DEFAULT_WAR_RATES, ["newMountMerges"], "historical").missingCosts, 1);
  assert.equal(estimateWar(banks, DEFAULT_WAR_RATES, ["skillSummons"], "historical").missingCosts, 1);
  assert.equal(estimateWar(banks, DEFAULT_WAR_RATES, ["hammers", "eggMerges"], "historical").missingCosts, 0);
  assert.equal(estimateWar(banks, DEFAULT_WAR_RATES, ["mountSummons", "newMountMerges"], "historical").missingCosts, 2);
});

test("historical legacy banks without planning details retain their original action model", () => {
  const legacy = entry({ eggsPetsTotal: 500, mountKeys: 120, mountsToMerge: 2 });
  delete legacy.planningDetails;
  const result = estimateWar([legacy], DEFAULT_WAR_RATES, ["newMountMerges", "eggMerges", "eggSummonMerges"], "historical");
  assert.equal(result.minimum, 0);
  assert.equal(result.maximum, 0);
  assert.equal(result.missingCosts, 0);
});

test("whole summon estimates retain affordable actions at decimal cost boundaries", () => {
  const priced = entry(
    { skillTickets: 351, mountKeys: 351 },
    { fiveSkills: 175.5, mount: 43.875 },
    { newMountMerges: 9 },
  );
  const result = estimateWar([priced], DEFAULT_WAR_RATES, ["skillSummons", "mountSummons", "newMountMerges"], "historical");
  assert.deepEqual(result.rows.map(({ activity, quantity }) => ({ activity, quantity })), [
    { activity: "skillSummons", quantity: 10 },
    { activity: "mountSummons", quantity: 8 },
    { activity: "newMountMerges", quantity: 8 },
  ]);
});

test("skill estimates match the reference inventory and round each member before combining", () => {
  const reference = entry({ skillTickets: 122_000 }, { fiveSkills: 160, mount: 40 });
  const result = estimateWar([reference], DEFAULT_WAR_RATES, ["skillSummons"]);
  assert.equal(result.rows[0].quantity, 3_812);
  assert.equal(result.minimum, 857_700);
  assert.equal(result.maximum, 857_700);
  const first = entry({ skillTickets: 159 }, { fiveSkills: 200, mount: 40 });
  const second = entry({ skillTickets: 159 }, { fiveSkills: 200, mount: 40 });
  assert.equal(estimateWar([first, second], DEFAULT_WAR_RATES, ["skillSummons"]).rows[0].quantity, 6);
});

test("war estimates reject an unsafe activity score and an unsafe total of individually safe rows", () => {
  const tooLarge = (error: unknown) =>
    error instanceof WarEstimateError && error.code === "ESTIMATE_TOO_LARGE";
  const limit = Number.MAX_SAFE_INTEGER;
  const boundary = entry({ hammers: limit });
  const boundaryRates = { ...DEFAULT_WAR_RATES, hammersMin: 1, hammersMax: 1, mountMerges: 1 };
  const exact = estimateWar([boundary], boundaryRates, ["hammers"]);
  assert.equal(exact.minimum, limit);
  assert.equal(exact.maximum, limit);
  assert.throws(() => estimateWar([boundary], DEFAULT_WAR_RATES, ["hammers"]), tooLarge);
  const maximumOnly = entry({ hammers: Math.floor(limit / DEFAULT_WAR_RATES.hammersMax) + 1 });
  assert.throws(() => estimateWar([maximumOnly], DEFAULT_WAR_RATES, ["hammers"]), tooLarge);

  const combined = entry({ hammers: limit - 1, mountsToMerge: 2 });
  assert.equal(estimateWar([combined], boundaryRates, ["hammers"]).maximum, limit - 1);
  assert.equal(estimateWar([combined], boundaryRates, ["mountMerges"]).maximum, 2);
  assert.throws(() => estimateWar([combined], boundaryRates, ["hammers", "mountMerges"]), tooLarge);
});

test("snipe participant estimates use current banks only for members who answered yes", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const yes = await addMember(db, "Attending");
    const no = await addMember(db, "Absent");
    const unanswered = await addMember(db, "Unanswered");
    await saveBank(db, yes, { hammers: 10 });
    await saveBank(db, no, { hammers: 1_000 });
    await saveBank(db, unanswered, { hammers: 10_000 });
    const plan = await makeSnipe(db, admin);
    await respondToSnipe(yes, plan.id, { answer: "yes" }, db);
    await respondToSnipe(no, plan.id, { answer: "no" }, db);
    let listed = (await listSnipes(admin, db)).plans[0];
    assert.deepEqual(listed.counts, { yes: 1, no: 1, unanswered: 2 });
    assert.deepEqual(listed.participants.map(({ member }) => member.id), [yes.id]);
    assert.equal(listed.estimate.minimum, 20);
    assert.equal(listed.estimate.maximum, 50);
    await saveBank(db, yes, { hammers: 12 });
    listed = (await listSnipes(admin, db)).plans[0];
    assert.equal(listed.estimate.minimum, 24);
    assert.equal(listed.estimate.maximum, 60);
    await respondToSnipe(yes, plan.id, { answer: "no" }, db);
    listed = (await listSnipes(admin, db)).plans[0];
    assert.deepEqual(listed.counts, { yes: 0, no: 2, unanswered: 2 });
    assert.equal(listed.participants.length, 0);
    assert.equal(listed.estimate.maximum, 0);
    assert.equal(listed.responses.length, 2);
  });
});

test("snipe archives freeze member profiles, responses and estimates against later changes", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const member = await addMember(db, "Original name");
    await saveBank(db, member, { hammers: 25, mountKeys: 80 });
    const plan = await makeSnipe(db, admin, ["hammers", "mountSummons"]);
    await respondToSnipe(member, plan.id, { answer: "yes" }, db);
    const archived = await updateSnipe(admin, plan.id, { archived: true }, db);
    assert.equal(archived.archived, true);
    assert.equal(archived.estimate.minimum, 2_210);
    await saveBank(db, member, { hammers: 900 });
    await db.query("INSERT INTO clan_settings (id,war_rates) VALUES ('clan',$1::jsonb)", [JSON.stringify({ mountSummons: 1 })]);
    await db.query("UPDATE app_members SET username='Changed name',active=FALSE WHERE id=$1", [member.id]);
    const listed = (await listSnipes(admin, db)).plans[0];
    assert.deepEqual(listed, archived);
    await assert.rejects(respondToSnipe(admin, plan.id, { answer: "yes" }, db), apiFailure("SNIPE_ARCHIVED"));
    await assert.rejects(updateSnipe(admin, plan.id, { title: "Rewrite history" }, db), apiFailure("SNIPE_ARCHIVED"));
    const reopened = await updateSnipe(admin, plan.id, { archived: false }, db);
    assert.equal(reopened.archived, false);
  });
});

test("snipe management checks current database roles rather than a stale admin object", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const member = await addMember(db, "Member");
    const plan = await makeSnipe(db, admin);
    await assert.rejects(makeSnipe(db, member), apiFailure("ADMIN_REQUIRED"));
    await assert.rejects(updateSnipe(member, plan.id, { activities: ["skillSummons"] }, db), apiFailure("ADMIN_REQUIRED"));
    await db.query("UPDATE app_members SET role='MEMBER' WHERE id=$1", [admin.id]);
    await assert.rejects(makeSnipe(db, admin), apiFailure("ADMIN_REQUIRED"));
    await assert.rejects(updateSnipe(admin, plan.id, { archived: true }, db), apiFailure("ADMIN_REQUIRED"));
    await db.query("UPDATE app_members SET role='ADMIN' WHERE id=$1", [member.id]);
    const updated = await updateSnipe(member, plan.id, { title: "Now authorized", activities: ["mountMerges"] }, db);
    assert.equal(updated.title, "Now authorized");
    assert.deepEqual(updated.activities, ["mountMerges"]);
  });
});

test("inactive accounts cannot read plans or Dew, respond to events, or buy and equip rewards", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const member = await addMember(db, "Inactive");
    const plan = await makeSnipe(db, admin);
    await db.query("UPDATE app_members SET active=FALSE WHERE id=$1", [member.id]);
    for (const operation of [
      () => listSnipes(member, db),
      () => respondToSnipe(member, plan.id, { answer: "yes" }, db),
      () => getDew(member, db),
      () => purchaseDewItem(member, DEW_ITEMS[0].id, db),
      () => equipDewItem(member, null, db),
    ]) await assert.rejects(operation(), apiFailure("ACCOUNT_INACTIVE"));
  });
});

test("complete bank updates award twenty Dew Points once per member per week, including concurrent saves", async () => {
  await withDatabase(async (db) => {
    const first = await addMember(db, "First");
    const second = await addMember(db, "Second");
    assert.equal((await getDew(first, db)).balance, 0);
    await Promise.all([
      db.transaction((tx) => awardDewForBankUpdate(tx, first.id)),
      db.transaction((tx) => awardDewForBankUpdate(tx, first.id)),
      db.transaction((tx) => awardDewForBankUpdate(tx, second.id)),
    ]);
    await db.transaction((tx) => awardDewForBankUpdate(tx, first.id));
    assert.equal((await getDew(first, db)).balance, 20);
    assert.equal((await getDew(first, db)).earnedToday, true);
    assert.equal((await getDew(first, db)).resourceRewardEarned, true);
    assert.equal((await getDew(second, db)).balance, 20);
    await db.query("UPDATE dew_weekly_earnings SET week_start=week_start - 7 WHERE member_id=$1", [first.id]);
    assert.equal((await getDew(first, db)).earnedToday, false);
    assert.equal((await getDew(first, db)).resourceRewardEarned, false);
    await db.transaction((tx) => awardDewForBankUpdate(tx, first.id));
    assert.equal((await getDew(first, db)).balance, 40);
    assert.equal((await getDew(first, db)).earnedToday, true);
  });
});

test("Dew purchases debit once, preserve insufficient balances, and allow only owned badges", async () => {
  await withDatabase(async (db) => {
    const member = await addMember(db, "Buyer");
    const reward = DEW_ITEMS[0];
    await assert.rejects(purchaseDewItem(member, reward.id, db), apiFailure("INSUFFICIENT_DEW"));
    await assert.rejects(equipDewItem(member, reward.id, db), apiFailure("DEW_ITEM_NOT_OWNED"));
    assert.deepEqual((await getDew(member, db)).owned, []);
    await db.query("INSERT INTO dew_balances (member_id,balance) VALUES ($1,$2)", [member.id, reward.cost]);
    const bought = await purchaseDewItem(member, reward.id, db);
    assert.equal(bought.balance, 0);
    assert.deepEqual(bought.owned, [reward.id]);
    assert.deepEqual(await purchaseDewItem(member, reward.id, db), bought);
    const equipped = await equipDewItem(member, reward.id, db);
    assert.equal(equipped.equipped, reward.id);
    assert.equal(equipped.balance, 0);
    assert.equal((await getDew(member, db)).equipped, reward.id);
    assert.equal((await db.query("SELECT badge FROM app_members WHERE id=$1", [member.id]))[0].badge, reward.id);
    assert.equal((await equipDewItem(member, null, db)).equipped, null);
    await assert.rejects(purchaseDewItem(member, "unknown-badge", db), apiFailure("DEW_ITEM_NOT_FOUND"));
    await assert.rejects(equipDewItem(member, "unknown-badge", db), apiFailure("DEW_ITEM_NOT_FOUND"));
    assert.deepEqual((await getDew(member, db)).owned, [reward.id]);
  });
});

test("concurrent Dew purchases cannot overspend or charge twice for one badge", async () => {
  await withDatabase(async (db) => {
    const member = await addMember(db, "Buyer");
    const first = DEW_ITEMS[0];
    const second = DEW_ITEMS.find((reward) => reward.id !== first.id && reward.cost === first.cost)!;
    assert.ok(second);
    await db.query("INSERT INTO dew_balances (member_id,balance) VALUES ($1,$2)", [member.id, first.cost]);
    const competing = await Promise.allSettled([
      purchaseDewItem(member, first.id, db),
      purchaseDewItem(member, second.id, db),
    ]);
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = competing.find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.equal(apiFailure("INSUFFICIENT_DEW")(rejected.reason), true);
    const after = await getDew(member, db);
    assert.equal(after.balance, 0);
    assert.equal(after.owned.length, 1);

    const another = await addMember(db, "Duplicate buyer");
    await db.query("INSERT INTO dew_balances (member_id,balance) VALUES ($1,$2)", [another.id, first.cost * 2]);
    const duplicate = await Promise.all([
      purchaseDewItem(another, first.id, db),
      purchaseDewItem(another, first.id, db),
    ]);
    assert.equal(duplicate.every((result) => result.balance === first.cost), true);
    assert.deepEqual((await getDew(another, db)).owned, [first.id]);
  });
});

test("snipe validation rejects unsupported actions and closes attendance after the start", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Admin", "ADMIN");
    const member = await addMember(db, "Member");
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await assert.rejects(createSnipe(admin, { title: " ", startsAt: future, activities: ["hammers"] }, db), apiFailure("INVALID_SNIPE"));
    await assert.rejects(createSnipe(admin, { title: "Snipe", startsAt: future, activities: [] }, db), apiFailure("INVALID_SNIPE"));
    await assert.rejects(createSnipe(admin, { title: "Snipe", startsAt: future, activities: ["potions" as WarActivity] }, db), apiFailure("INVALID_SNIPE"));
    await assert.rejects(createSnipe(admin, { title: "Snipe", startsAt: "invalid", activities: ["hammers"] }, db), apiFailure("INVALID_SNIPE_TIME"));
    await assert.rejects(createSnipe(admin, { title: "Snipe", startsAt: "2020-01-01T00:00:00Z", activities: ["hammers"] }, db), apiFailure("INVALID_SNIPE_TIME"));
    assert.deepEqual((await listSnipes(admin, db)).plans, []);
    const plan = await makeSnipe(db, admin);
    await db.query("UPDATE snipe_plans SET starts_at=NOW() - INTERVAL '1 minute' WHERE id=$1", [plan.id]);
    await assert.rejects(respondToSnipe(member, plan.id, { answer: "yes" }, db), apiFailure("SNIPE_STARTED"));
    assert.equal((await listSnipes(admin, db)).plans[0].responses.length, 0);
    await assert.rejects(respondToSnipe(member, randomUUID(), { answer: "yes" }, db), apiFailure("SNIPE_NOT_FOUND"));
    const archived = await updateSnipe(admin, plan.id, { archived: true }, db);
    assert.equal(archived.archived, true);
    assert.equal(archived.responses.length, 0);
  });
});

test("the Snipes tab counts upcoming snipes the member hasn't answered", async () => {
  await withDatabase(async (db) => {
    const admin = await addMember(db, "Leader", "ADMIN");
    const member = await addMember(db, "Member");
    assert.equal(await snipesToAnswer(member.id, db), 0);
    const first = await makeSnipe(db, admin);
    const second = await makeSnipe(db, admin);
    assert.equal(await snipesToAnswer(member.id, db), 2);
    await respondToSnipe(member, first.id, { answer: "no" }, db);
    assert.equal(await snipesToAnswer(member.id, db), 1, "No counts as an answer");
    // Archived snipes and ones that have started aren't counted.
    await updateSnipe(admin, second.id, { archived: true }, db);
    assert.equal(await snipesToAnswer(member.id, db), 0);
    await makeSnipe(db, admin);
    assert.equal(await snipesToAnswer(member.id, db, new Date(Date.now() + 2 * 86_400_000)), 0);
  });
});
