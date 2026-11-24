import assert from "node:assert/strict";
import { test } from "node:test";
import { assessBankCompleteness } from "../src/lib/completeness";
import { FORGE_ERA_POINTS, FORGE_ERAS, FORGE_MAX_LEVEL, FORGE_ODDS, forgePointsPerHammer, validForgeLevel } from "../src/lib/forge";
import { EMPTY_RESOURCES } from "../src/lib/resources";
import { planningDetailsSchema } from "../src/lib/server/validation";
import type { ResourceEntry } from "../src/lib/types";
import { DEFAULT_WAR_RATES, estimateWar } from "../src/lib/war";

const entry = (hammers: number, forgeLevel?: number) => ({
  id: "e", memberId: "m", weekStart: "2026-11-23", updatedAt: "2026-11-23T00:00:00Z", updatedBy: "m",
  resources: { ...EMPTY_RESOURCES, hammers }, summoningCosts: { fiveSkills: 200, mount: 50 },
  planningDetails: { calculationVersion: 2, ...(forgeLevel === undefined ? {} : { forgeLevel }) },
} as unknown as ResourceEntry);

test("the official forging odds cover every forge level up to 50, Primitive to Eternal", () => {
  assert.equal(FORGE_ODDS.length, FORGE_MAX_LEVEL);
  assert.equal(FORGE_ERAS.length, 13);
  assert.equal(FORGE_ERA_POINTS.length, 13);
  FORGE_ODDS.forEach((odds, index) => {
    assert.equal(odds.length, 13, `level ${index + 1}`);
    // The sheet shows two decimals, so a level can add up to 100 ± 0.05.
    assert.ok(Math.abs(odds.reduce((sum, chance) => sum + chance, 0) - 100) <= 0.05 + 1e-9, `level ${index + 1}`);
  });
});

test("points per hammer follow the forge level: 1 at the start, always 3 from level 30 (Multiverse and later)", () => {
  assert.equal(forgePointsPerHammer(1), 1);
  assert.equal(forgePointsPerHammer(8), 1.002, "0.2% Modern at 2 points");
  // Level 29: 6.99% Interstellar (2 points), the rest Multiverse or later (3), weighed by the row's 100.01%.
  assert.equal(forgePointsPerHammer(29), 2.930107);
  for (let level = 30; level <= FORGE_MAX_LEVEL; level++) assert.equal(forgePointsPerHammer(level), 3, `level ${level}`);
  assert.equal(validForgeLevel(1), 1);
  assert.equal(validForgeLevel(50), 50);
  for (const bad of [0, 51, 2.5, Number.NaN, "30", undefined, null]) assert.equal(validForgeLevel(bad), null, String(bad));
});

test("hammer estimates use each member's forge level, and the general range only for members without one", () => {
  // Level 30: 3 points a hammer. No level: the general 1–3. Clan tech maxed: +80%.
  const estimate = estimateWar([entry(100, 30), entry(100)], DEFAULT_WAR_RATES, ["hammers"], "current", { hammers: 80 });
  assert.equal(estimate.rows[0].quantity, 200);
  assert.deepEqual([estimate.minimum, estimate.maximum], [(300 + 100) * 1.8, (300 + 300) * 1.8]);
  // Everyone with a level: one exact number.
  const exact = estimateWar([entry(100, 1), entry(1_000, 45)], DEFAULT_WAR_RATES, ["hammers"]);
  assert.deepEqual([exact.minimum, exact.maximum], [3_100, 3_100]);
  // A saved level outside 1–50 is ignored rather than trusted.
  const ignored = estimateWar([entry(100, 99)], DEFAULT_WAR_RATES, ["hammers"]);
  assert.deepEqual([ignored.minimum, ignored.maximum], [100, 300]);
});

test("the forge level is optional, but must be a whole number from 1 to 50 when given", () => {
  assert.equal(planningDetailsSchema.safeParse({}).success, true);
  assert.equal(planningDetailsSchema.safeParse({ forgeLevel: 1 }).success, true);
  assert.equal(planningDetailsSchema.safeParse({ forgeLevel: 50 }).success, true);
  for (const bad of [0, 51, 2.5]) assert.equal(planningDetailsSchema.safeParse({ forgeLevel: bad }).success, false, String(bad));
  const bank = (forgeLevel?: number) => ({
    resources: { ...EMPTY_RESOURCES },
    summoningCosts: { fiveSkills: 150, mount: 40 },
    planningDetails: { skillLevel: 1, mountLevel: 1, eggLevel: 1, newMountMerges: 0, eggMerges: 0, eggSummonMerges: 0, extraMountChancePercent: 0, extraPetSummonPercent: 0, forgeLevel },
  });
  assert.deepEqual(assessBankCompleteness(bank()), { complete: true, missing: [] });
  assert.deepEqual(assessBankCompleteness(bank(35)), { complete: true, missing: [] });
  assert.deepEqual(assessBankCompleteness(bank(60)), { complete: false, missing: ["Forge level"] });
  assert.deepEqual(assessBankCompleteness(bank(Number.NaN)), { complete: false, missing: ["Forge level"] });
});
