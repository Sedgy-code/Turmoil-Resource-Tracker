import { test } from "node:test";
import assert from "node:assert/strict";
import { countdown, nextUseDay, warDay } from "../src/lib/war-calendar";

test("war day 1 starts Monday 00:00 UTC", () => {
  assert.equal(warDay(new Date("2026-10-12T00:00:00Z")).day, 1);
  assert.equal(warDay(new Date("2026-10-11T23:59:00Z")).day, 7);
  const friday = warDay(new Date("2026-10-16T07:36:00Z"));
  assert.equal(friday.day, 5);
  assert.equal(friday.nextDay.toISOString(), "2026-10-17T00:00:00.000Z");
  assert.equal(friday.weekEnd.toISOString(), "2026-10-19T00:00:00.000Z");
});

test("next day a resource scores", () => {
  const tuesday = new Date("2026-10-13T05:00:00Z");
  assert.equal(nextUseDay("hammers", tuesday), 3);
  assert.equal(nextUseDay("mountKeys", tuesday), 2);
  assert.equal(nextUseDay("hammers", new Date("2026-10-17T05:00:00Z")), null);
});

test("countdown text", () => {
  const now = new Date("2026-10-16T07:36:00Z");
  assert.equal(countdown(new Date("2026-10-19T00:00:00Z"), now), "2d 16h");
  assert.equal(countdown(new Date("2026-10-16T12:48:00Z"), now), "5h 12m");
  assert.equal(countdown(new Date("2026-10-16T07:40:00Z"), now), "4m");
});
