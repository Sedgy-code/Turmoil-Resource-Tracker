import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  CHANCE_PLANNING_DETAILS,
  EMPTY_PLANNING_DETAILS,
  EMPTY_RESOURCES,
  normalizeResources,
  type PlanningDetails,
  type ResourceValues,
  type SummoningCosts,
} from "../src/lib/resources";
import type { ResourceEntry, WarActivity } from "../src/lib/types";
import { DEFAULT_WAR_RATES, estimateWar, WarEstimateError } from "../src/lib/war";
import { planningDetailsSchema, resourceSchema, saveBankSchema, saveResourcesSchema } from "../src/lib/server/validation";

function bank(
  resources: Partial<ResourceValues> = {},
  planningDetails: Partial<PlanningDetails> = {},
  summoningCosts: SummoningCosts = { fiveSkills: 150, mount: 40 },
): ResourceEntry {
  return {
    id: randomUUID(), memberId: randomUUID(), week: "2026-10-12",
    resources: { ...EMPTY_RESOURCES, ...resources },
    summoningCosts,
    planningDetails: { ...CHANCE_PLANNING_DETAILS, ...planningDetails },
    notes: "", updatedAt: "2026-10-12T01:00:00.000Z",
    updatedBy: { id: randomUUID(), username: "Chance member" },
  };
}
const chanceActivities: WarActivity[] = ["newMountMerges", "eggMerges", "eggSummonMerges"];

test("current chance estimates apply each member's percentage to their whole mount summons and eggshells", () => {
  const first = bank(
    { mountKeys: 1000, eggsPetsTotal: 10, eggshellsTotal: 1000 },
    { extraMountChancePercent: 20, extraPetSummonPercent: 20 },
  );
  const second = bank(
    { mountKeys: 99, eggsPetsTotal: 5, eggshellsTotal: 250 },
    { extraMountChancePercent: 12.5, extraPetSummonPercent: 50 },
  );
  const result = estimateWar([first, second], DEFAULT_WAR_RATES, chanceActivities);
  assert.deepEqual(result.rows.map(({ activity, quantity, minimum }) => ({ activity, quantity, minimum })), [
    { activity: "newMountMerges", quantity: 5.25, minimum: 5670 },
    { activity: "eggMerges", quantity: 15, minimum: 33750 },
    { activity: "eggSummonMerges", quantity: 3.25, minimum: 7313 },
  ]);
  assert.equal(result.minimum, 46733);
  assert.equal(result.maximum, 46733);
  assert.equal(result.missingCosts, 0);
});

test("chance estimates retain fractional actions until clan points are rounded once per activity", () => {
  const smallBonus = bank({ mountKeys: 40 }, { extraMountChancePercent: 0.01 });
  assert.equal(estimateWar([smallBonus], DEFAULT_WAR_RATES, ["newMountMerges"]).minimum, 0);
  const combined = estimateWar(Array.from({ length: 5 }, () => smallBonus), DEFAULT_WAR_RATES, ["newMountMerges"]);
  assert.equal(combined.rows[0].quantity, 0.0005);
  assert.equal(combined.minimum, 1);
  const smallPet = bank({ eggshellsTotal: 1 }, { extraPetSummonPercent: 50 });
  assert.equal(estimateWar([smallPet, smallPet], DEFAULT_WAR_RATES, ["eggSummonMerges"]).minimum, 23);
  const decimalChance = bank({ eggshellsTotal: 501 }, { extraPetSummonPercent: 33.33 });
  const decimal = estimateWar([decimalChance], DEFAULT_WAR_RATES, ["eggSummonMerges"]);
  assert.equal(decimal.rows[0].quantity, 1.669833);
  assert.equal(decimal.minimum, 3757);
});

test("bonus percentages above 100% are supported and mount keys are never treated as summon counts", () => {
  const highBonus = bank(
    { mountKeys: 1000, eggshellsTotal: 1000 },
    { extraMountChancePercent: 1000, extraPetSummonPercent: 1000 },
  );
  const result = estimateWar([highBonus], DEFAULT_WAR_RATES, ["newMountMerges", "eggSummonMerges"]);
  assert.deepEqual(result.rows.map(({ quantity }) => quantity), [250, 100]);
  const leftover = bank({ mountKeys: 79 }, { extraMountChancePercent: 100 });
  assert.equal(estimateWar([leftover, leftover], DEFAULT_WAR_RATES, ["newMountMerges"]).rows[0].quantity, 2);
});

test("current estimates use existing eggs/pets and ignore prior manual counts", () => {
  const legacy = bank({ eggsPetsTotal: 500, mountKeys: 120, eggshellsTotal: 1000 });
  legacy.planningDetails = { ...EMPTY_PLANNING_DETAILS, newMountMerges: 2, eggMerges: 7, eggSummonMerges: 9 };
  const current = estimateWar([legacy], DEFAULT_WAR_RATES, chanceActivities);
  assert.deepEqual(current.rows.map(({ quantity }) => quantity), [0, 500, 0]);
  const historical = estimateWar([legacy], DEFAULT_WAR_RATES, chanceActivities, "historical");
  assert.deepEqual(historical.rows.map(({ quantity }) => quantity), [2, 7, 9]);
  delete legacy.planningDetails;
  assert.equal(estimateWar([legacy], DEFAULT_WAR_RATES, ["eggMerges"]).rows[0].quantity, 500);
  assert.equal(estimateWar([legacy], DEFAULT_WAR_RATES, ["eggMerges"], "historical").rows[0].quantity, 0);
});

test("historical chance snapshots retain the new model and can coexist with legacy snapshots", () => {
  const modern = bank(
    { mountKeys: 120, eggsPetsTotal: 10, eggshellsTotal: 1000 },
    { extraMountChancePercent: 50, extraPetSummonPercent: 25 },
  );
  const legacy = bank({ mountKeys: 120, eggsPetsTotal: 50 });
  legacy.planningDetails = { ...EMPTY_PLANNING_DETAILS, newMountMerges: 10, eggMerges: 2, eggSummonMerges: 1 };
  const combined = estimateWar([modern, legacy], DEFAULT_WAR_RATES, chanceActivities, "historical");
  assert.deepEqual(combined.rows.map(({ quantity }) => quantity), [4.5, 12, 3.5]);
  delete modern.planningDetails!.calculationVersion;
  assert.deepEqual(
    estimateWar([modern], DEFAULT_WAR_RATES, chanceActivities, "historical").rows.map(({ quantity }) => quantity),
    [1.5, 10, 2.5],
  );
});

test("missing summon costs affect selected positive mount bonuses once per member", () => {
  const missing = bank({ mountKeys: 100, skillTickets: 100 }, { extraMountChancePercent: 20 }, { fiveSkills: 0, mount: 0 });
  const noBonus = bank({ mountKeys: 100 }, { extraMountChancePercent: 0 }, { fiveSkills: 0, mount: 0 });
  assert.equal(estimateWar([missing, noBonus], DEFAULT_WAR_RATES, ["newMountMerges"]).missingCosts, 1);
  assert.equal(estimateWar([missing, noBonus], DEFAULT_WAR_RATES, ["mountSummons", "newMountMerges"]).missingCosts, 2);
  assert.equal(estimateWar([missing], DEFAULT_WAR_RATES, ["skillSummons", "newMountMerges"]).missingCosts, 2);
  assert.equal(estimateWar([missing], DEFAULT_WAR_RATES, ["eggMerges", "eggSummonMerges"]).missingCosts, 0);
});

test("chance estimates reject unsafe scores and preserve exact integer boundaries", () => {
  const tooLarge = (error: unknown) => error instanceof WarEstimateError && error.code === "ESTIMATE_TOO_LARGE";
  const largest = bank({ eggsPetsTotal: Number.MAX_SAFE_INTEGER });
  assert.equal(estimateWar([largest], { ...DEFAULT_WAR_RATES, eggMerges: 1 }, ["eggMerges"]).maximum, Number.MAX_SAFE_INTEGER);
  assert.throws(() => estimateWar([largest], DEFAULT_WAR_RATES, ["eggMerges"]), tooLarge);
  const mountBonus = bank({ mountKeys: Number.MAX_SAFE_INTEGER }, { extraMountChancePercent: 1000 });
  assert.throws(() => estimateWar([mountBonus], DEFAULT_WAR_RATES, ["newMountMerges"]), tooLarge);
  const combined = bank({ hammers: Number.MAX_SAFE_INTEGER - 1, eggshellsTotal: 1 }, { extraPetSummonPercent: 100 });
  assert.throws(() => estimateWar([combined], { ...DEFAULT_WAR_RATES, hammersMin: 1, hammersMax: 1 }, ["hammers", "eggSummonMerges"]), tooLarge);
});

test("eggshell totals normalize legacy absence to zero and validate integer bounds", () => {
  assert.equal(normalizeResources({ eggsPetsTotal: 23 }).eggshellsTotal, 0);
  assert.equal(resourceSchema.parse({ eggshellsTotal: 123 }).eggshellsTotal, 123);
  assert.equal(resourceSchema.parse({ eggshellsTotal: 1_000_000_000 }).eggshellsTotal, 1_000_000_000);
  for (const eggshellsTotal of [-1, 0.5, 1_000_000_001, Infinity, NaN, "1", null]) {
    assert.equal(resourceSchema.safeParse({ eggshellsTotal }).success, false);
  }
});

test("chance validation accepts exact zero and two decimal places without upgrading legacy details", () => {
  assert.deepEqual(planningDetailsSchema.parse(EMPTY_PLANNING_DETAILS), EMPTY_PLANNING_DETAILS);
  assert.equal("calculationVersion" in EMPTY_PLANNING_DETAILS, false);
  for (const field of ["extraMountChancePercent", "extraPetSummonPercent"] as const) {
    for (const value of [0, 0.01, 12.5, 33.33, 100, 1000]) {
      assert.equal(planningDetailsSchema.parse({ [field]: value })[field], value);
    }
    for (const value of [-1, 0.001, 1000.01, Infinity, NaN, "20", null]) {
      assert.equal(planningDetailsSchema.safeParse({ [field]: value }).success, false);
    }
  }
  assert.equal(planningDetailsSchema.safeParse({ calculationVersion: 1 }).success, false);
  assert.deepEqual(planningDetailsSchema.parse({ extraMountChancePercent: 20 }), {
    ...EMPTY_PLANNING_DETAILS, extraMountChancePercent: 20,
  });
});

test("live bank saves require every resource, both costs, levels and explicit bonus percentages", () => {
  const valid = {
    resources: { ...EMPTY_RESOURCES },
    summoningCosts: { fiveSkills: 150, mount: 40 },
    planningDetails: { ...CHANCE_PLANNING_DETAILS },
  };
  assert.equal(saveBankSchema.safeParse(valid).success, true);
  for (const key of Object.keys(valid.resources)) {
    const incomplete = structuredClone(valid) as Record<string, unknown>;
    delete (incomplete.resources as Record<string, unknown>)[key];
    assert.equal(saveBankSchema.safeParse(incomplete).success, false, `Missing ${key}`);
  }
  for (const field of ["skillLevel", "mountLevel", "eggLevel", "extraMountChancePercent", "extraPetSummonPercent"]) {
    const incomplete = structuredClone(valid) as Record<string, unknown>;
    delete (incomplete.planningDetails as Record<string, unknown>)[field];
    assert.equal(saveBankSchema.safeParse(incomplete).success, false, `Missing ${field}`);
  }
  for (const field of ["summoningCosts", "planningDetails"]) {
    const incomplete = structuredClone(valid) as Record<string, unknown>;
    delete incomplete[field];
    assert.equal(saveBankSchema.safeParse(incomplete).success, false);
  }
  const onlyNewFields = saveBankSchema.parse({
    ...valid,
    planningDetails: { skillLevel: 0, mountLevel: 0, eggLevel: 0, extraMountChancePercent: 0, extraPetSummonPercent: 0 },
  });
  assert.deepEqual(onlyNewFields.planningDetails, CHANCE_PLANNING_DETAILS);
  assert.equal(saveResourcesSchema.safeParse({ week: "2026-10-12", resources: { hammers: 10 } }).success, true);
});
