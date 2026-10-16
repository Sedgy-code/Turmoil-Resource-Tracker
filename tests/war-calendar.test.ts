import { test } from "node:test";
import assert from "node:assert/strict";
import { countdown, nextUseDay, raceEnd, warDay, warWeekOf } from "../src/lib/war-calendar";

test("war day 1 starts Tuesday 00:00 UTC; Day 7 is Monday", () => {
  assert.equal(warDay(new Date("2026-10-13T00:00:00Z")).day, 1);
  assert.equal(warDay(new Date("2026-10-12T23:59:00Z")).day, 7);
  assert.equal(warDay(new Date("2026-10-12T00:30:00Z")).day, 7);
  // In-game: Friday 08:26 UTC showed "Day 4", ending in 15h 34m.
  const friday = warDay(new Date("2026-10-16T08:26:00Z"));
  assert.equal(friday.day, 4);
  assert.equal(friday.nextDay.toISOString(), "2026-10-17T00:00:00.000Z");
  assert.equal(friday.weekEnd.toISOString(), "2026-10-20T00:00:00.000Z");
});

test("war results saved on Day 7 belong to the war that just ended", () => {
  assert.equal(warWeekOf(new Date("2026-10-19T12:00:00Z")), "2026-10-12");
  assert.equal(warWeekOf(new Date("2026-10-13T12:00:00Z")), "2026-10-12");
  assert.equal(warWeekOf(new Date("2026-10-20T12:00:00Z")), "2026-10-19");
});

test("tech race ends Monday 00:00 UTC", () => {
  assert.equal(raceEnd(new Date("2026-10-16T07:36:00Z")).toISOString(), "2026-10-19T00:00:00.000Z");
});

test("next day a resource scores", () => {
  const wednesday = new Date("2026-10-14T05:00:00Z");
  assert.equal(nextUseDay("hammers", wednesday), 3);
  assert.equal(nextUseDay("mountKeys", wednesday), 2);
  assert.equal(nextUseDay("hammers", new Date("2026-10-18T05:00:00Z")), null);
});

test("countdown text", () => {
  const now = new Date("2026-10-16T07:36:00Z");
  assert.equal(countdown(new Date("2026-10-19T00:00:00Z"), now), "2d 16h");
  assert.equal(countdown(new Date("2026-10-16T12:48:00Z"), now), "5h 12m");
  assert.equal(countdown(new Date("2026-10-16T07:40:00Z"), now), "4m");
});
