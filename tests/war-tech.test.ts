import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResourceEntry } from "../src/lib/types";
import { TECH_NODES } from "../src/lib/clan-tech";
import { boostedRate, boostedRates, DEFAULT_WAR_RATES, estimateWar, WAR_ACTIVITIES, warBoost, warTechFromLevels } from "../src/lib/war";

const entry = (resources: Record<string, number>) => ({
  id: "e", memberId: "m", weekStart: "2026-11-23", updatedAt: "2026-11-23T00:00:00Z", updatedBy: "m",
  resources, summoningCosts: { fiveSkills: 200, mount: 50 }, planningDetails: { calculationVersion: 2 },
} as unknown as ResourceEntry);

test("clan tech: each 'War Points From …' and 'On Day …' level adds 4%, capped at level 10", () => {
  const tech = warTechFromLevels({
    "war-points-from-skill-summon": 10, "war-points-from-mount-summon": 5, "war-points-from-forging": 12,
    "war-points-on-day-1": 10, "war-points-on-day-2": 3, "war-points-on-day-3": 10, "war-points-on-day-4": 10, "war-points-on-day-5": 10,
  });
  assert.equal(tech.activity.skillSummons, 40);
  assert.equal(tech.activity.mountSummons, 20);
  assert.equal(tech.activity.hammers, 40, "capped at 10 levels");
  assert.equal(tech.activity.eggMerges, 0, "no Pet Merge tech yet");
  // On a war day: that activity's tech plus that day's, added together.
  assert.equal(warBoost(tech, 1).skillSummons, 80);
  assert.equal(warBoost(tech, 2).skillSummons, 52, "Day 2 is only level 3: 40% + 12%");
  // No day given: the lowest of the clan days (Days 1–5), here Day 2's.
  assert.equal(warBoost(tech, null).skillSummons, 52);
  assert.equal(warBoost(tech, 6).skillSummons, 40, "no Day 6 tech yet");
  assert.deepEqual(warBoost(undefined, 1), {});
  assert.equal(boostedRate(225, 80), 405);
  assert.equal(boostedRate(2, 80), 3.6);
});

test("estimates add the clan tech bonus to the game's base points, and are unchanged without it", () => {
  // 10,000 tickets at 200 for 5 skills = 250 skill summons, at the game's base 125 points.
  const plain = estimateWar([entry({ skillTickets: 10_000 })], DEFAULT_WAR_RATES, ["skillSummons"]);
  assert.equal(plain.minimum, 250 * 125);
  // Skill Summon tech and the day's tech both maxed: +40% + 40% = 225 a summon, as in the game.
  const boosted = estimateWar([entry({ skillTickets: 10_000 })], DEFAULT_WAR_RATES, ["skillSummons"], "current", { skillSummons: 80 });
  assert.equal(boosted.minimum, 250 * 225);
  // Hammers keep their fractions until the total: 1,000 hammers × 1–3 × 1.8.
  const hammers = estimateWar([entry({ hammers: 1_000 })], DEFAULT_WAR_RATES, ["hammers"], "current", { hammers: 80 });
  assert.deepEqual([hammers.minimum, hammers.maximum], [1_800, 5_400]);
});

test("clan tech bonuses read the Clan Tech page's own war point nodes", () => {
  // Every Clan War node maxed: each activity and each day must pick up its +40%.
  const maxed = Object.fromEntries(TECH_NODES.filter((entry) => entry.section === "Clan War").map((entry) => [entry.key, entry.max]));
  const tech = warTechFromLevels(maxed);
  for (const { key } of WAR_ACTIVITIES) assert.equal(tech.activity[key], 40, key);
  for (const day of [1, 2, 3, 4, 5, 6]) assert.equal(tech.day[day], 40, `Day ${day}`);
});

test("members see each rate with its clan tech: the official base points become the in-game numbers", () => {
  // Turmoil's tree: every War Points node maxed except Pet Merge.
  const tech = warTechFromLevels({
    "war-points-from-forging": 10, "war-points-from-skill-summon": 10, "war-points-from-mount-summon": 10, "war-points-from-mount-merge": 10,
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((day) => [`war-points-on-day-${day}`, 10])),
  });
  assert.deepEqual(boostedRates(DEFAULT_WAR_RATES, warBoost(tech, null)), {
    hammersMin: 1.8, hammersMax: 5.4, skillSummons: 225, mountSummons: 1080, newMountMerges: 1080, mountMerges: 1080,
    eggMerges: 1750, eggSummonMerges: 1750,
  });
  assert.deepEqual(boostedRates(DEFAULT_WAR_RATES), DEFAULT_WAR_RATES, "no clan tech: the base points");
});
