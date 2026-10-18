import assert from "node:assert/strict";
import { test } from "node:test";
import { dayPoints, pillarCounts, rankPairs, twinDays } from "../src/lib/clan-day-planner";

// Hammers 100, skills 50, mounts 60 (summons, bonus and existing merges), eggs/pets 60.
const POINTS = { hammers: 100, skillSummons: 50, mountSummons: 30, newMountMerges: 10, mountMerges: 20, eggMerges: 40, eggSummonMerges: 20 };

test("each day on its own counts everything that scores that day", () => {
  assert.deepEqual(dayPoints(POINTS), [150, 60, 210, 60, 160]);
});

test("pairs are ranked by their weaker day, with shared resources split between the two days", () => {
  const pairs = rankPairs(POINTS, { "1,3": 4, "2,4": 9 }, { mounts: 3, skills: 1 });
  const find = (a: number, b: number) => pairs.find((pair) => pair.days[0] === a && pair.days[1] === b)!;
  // Days 1 and 3 share hammers and skills; Day 3 also has eggs. Balanced: 105 each.
  assert.deepEqual(find(1, 3).perDay, [105, 105]);
  // Days 2 and 3 share nothing: the weaker day is the mount day.
  assert.equal(find(2, 3).weaker, 60);
  // Two mount days split the same mounts, so low mounts make a weak pair, however popular.
  assert.deepEqual(find(2, 4).perDay, [30, 30]);
  assert.equal(find(2, 4).votes, 9);
  assert.deepEqual(find(2, 4).ascending, { mounts: 3 });
  assert.deepEqual(find(1, 3).ascending, { skills: 1 });
  // Strongest first; ties go to the pair with more votes.
  assert.deepEqual(pairs.slice(0, 3).map((pair) => pair.days), [[1, 3], [1, 5], [3, 5]]);
  // Same weaker day (a mount day): the pair with the stronger other day comes first.
  assert.deepEqual(pairs.slice(3, 7).map((pair) => pair.days), [[2, 3], [3, 4], [2, 5], [4, 5]]);
  assert.equal(pairs.at(-1)!.days.join(","), "2,4");
  assert.equal(pairs.length, 10);
});

test("ascending answers are counted per pillar", () => {
  assert.deepEqual(pillarCounts([{ pillars: ["skills", "pets"] }, { pillars: ["skills"] }, { pillars: [] }]), { skills: 2, pets: 1 });
});

test("Days 2 and 4 score with the same resources", () => {
  assert.deepEqual(twinDays(), [[2, 4]]);
});
