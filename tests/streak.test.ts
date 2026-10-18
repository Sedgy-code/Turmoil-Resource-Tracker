import assert from "node:assert/strict";
import { test } from "node:test";
import { awayWeeksFrom, savingStreak } from "../src/lib/streak";

test("the saving streak counts weeks in a row, and this week can't break it yet", () => {
  const saved = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"];
  // Not saved yet this week: the run up to last week still stands.
  assert.deepEqual(savingStreak(saved, [], "2026-10-19"), { weeks: 4, best: 4 });
  assert.deepEqual(savingStreak([...saved, "2026-10-19"], [], "2026-10-19"), { weeks: 5, best: 5 });
  // A missed week ends it; the best run is kept.
  assert.deepEqual(savingStreak(saved, [], "2026-10-26"), { weeks: 0, best: 4 });
  assert.deepEqual(savingStreak([], [], "2026-10-19"), { weeks: 0, best: 0 });
});

test("weeks away pause the streak instead of breaking it", () => {
  const saved = ["2026-09-21", "2026-09-28", "2026-10-12"];
  assert.deepEqual(savingStreak(saved, ["2026-10-05"], "2026-10-19"), { weeks: 3, best: 3 });
  assert.deepEqual(savingStreak(saved, [], "2026-10-19"), { weeks: 1, best: 2 });
});

test("time away comes from the holiday history", () => {
  const weeks = awayWeeksFrom([
    { kind: "holiday", detail: "2026-10-09", at: "2026-10-01T10:00:00.000Z" },
    { kind: "holiday", detail: "2026-11-20 · Visiting family", at: "2026-11-02T10:00:00.000Z" },
    { kind: "holiday-ended", detail: "", at: "2026-11-05T10:00:00.000Z" },
  ]).sort();
  assert.deepEqual(weeks, ["2026-09-28", "2026-10-05", "2026-11-02"]);
});
