import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeReadings, newRow, readGroups } from "../src/lib/war-records";

const reading = (rows: { gameName: string; points: number | null; memberId?: string | null }[]) =>
  ({ clanTotal: null, rows: rows.map((row) => ({ memberId: null, ...row })) });
const summary = (rows: { gameName: string; memberId: string; points: string }[]) => rows.map(({ gameName, memberId, points }) => [gameName, memberId, points]);

test("a 50-member list is read in small groups, in order, each under the size limit", () => {
  const shots = Array.from({ length: 8 }, (_, index) => ({ id: index, data: "x".repeat(600_000) }));
  const groups = readGroups(shots);
  assert.deepEqual(groups.map((group) => group.map((shot) => shot.id)), [[0, 1], [2, 3], [4, 5], [6, 7]]);
  const big = [{ id: 0, data: "x".repeat(1_800_000) }, { id: 1, data: "x".repeat(1_800_000) }, { id: 2, data: "x".repeat(100) }];
  assert.deepEqual(readGroups(big).map((group) => group.map((shot) => shot.id)), [[0], [1, 2]]);
});

test("players seen in overlapping screenshots appear once", () => {
  const { rows, added } = mergeReadings([], [
    reading([{ gameName: "Lone Wolf", points: 500, memberId: "m1" }, { gameName: "Ash", points: 300 }]),
    reading([{ gameName: "lonewolf", points: 500 }, { gameName: "Mira", points: null }]),
  ]);
  assert.equal(added, 3);
  assert.deepEqual(summary(rows), [["Lone Wolf", "m1", "500"], ["Ash", "", "300"], ["Mira", "", ""]]);
});

test("rows typed by hand keep their numbers; readings only fill what's missing", () => {
  const typed = [
    newRow({ gameName: "Kael", memberId: "m1", points: "" }),
    newRow({ gameName: "Ash", memberId: "", points: "999" }),
  ];
  const { rows, added } = mergeReadings(typed, [reading([
    { gameName: "Kael", points: 120 },
    { gameName: "ASH", points: 300, memberId: "m2" },
    { gameName: "K4el", points: 50, memberId: "m1" },
    { gameName: "Zed", points: 0 },
  ])]);
  assert.equal(added, 1);
  assert.deepEqual(summary(rows), [["Kael", "m1", "120"], ["Ash", "m2", "999"], ["Zed", "", "0"]]);
  assert.equal(typed[0].points, "", "the table being edited isn't changed in place");
});
