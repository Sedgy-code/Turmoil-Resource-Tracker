import assert from "node:assert/strict";
import { test } from "node:test";
import { beforeResetTime, displaySnipeTitle, minutesBeforeReset, nextSnipeStart, RESET_LEAD_MINUTES, snipeDay, snipeDayActivities, snipeTitle } from "../src/lib/snipe-day";
import { googleCalendarLink, snipeCalendarFile } from "../src/lib/snipe-calendar";

// The war that starts on Tuesday 20 Oct 2026: Day 3 is Thursday 22 Oct.
const thursdayMorning = new Date("2026-10-22T08:00:00Z");

test("a snipe on war Day 1–5 lands on the next time that day comes round", () => {
  assert.equal(nextSnipeStart(3, "10:00", thursdayMorning).toISOString(), "2026-10-22T10:00:00.000Z", "later today");
  assert.equal(nextSnipeStart(3, "06:00", thursdayMorning).toISOString(), "2026-10-29T06:00:00.000Z", "already passed: next war");
  assert.equal(nextSnipeStart(1, "10:00", thursdayMorning).toISOString(), "2026-10-27T10:00:00.000Z", "Day 1 is over: next war");
  assert.equal(nextSnipeStart(5, "23:30", thursdayMorning).toISOString(), "2026-10-24T23:30:00.000Z");
  // On Day 7 (Monday) every spending day is in the next war.
  assert.equal(nextSnipeStart(1, "00:00", new Date("2026-10-26T12:00:00Z")).toISOString(), "2026-10-27T00:00:00.000Z");
});

test("each day offers only what scores that day, and the title says the day and the resources", () => {
  assert.deepEqual(snipeDayActivities(1), ["hammers", "skillSummons"]);
  assert.deepEqual(snipeDayActivities(2), ["mountSummons", "newMountMerges", "mountMerges"]);
  assert.deepEqual(snipeDayActivities(6), []);
  assert.equal(snipeTitle(3, snipeDayActivities(3)), "Day 3 – Hammers, Skills, Pets");
  assert.equal(snipeTitle(2, snipeDayActivities(2)), "Day 2 – Mounts");
  assert.equal(snipeTitle(5, ["hammers"]), "Day 5 – Hammers");
  assert.equal(snipeDay("2026-10-22T10:00:00Z"), 3);
  assert.equal(snipeDay("2026-10-25T10:00:00Z"), null, "Sunday is the battle (Day 6)");
});

test("titles the Hub wrote show in each member's language; a leader's own title stays", () => {
  const words: Record<string, string> = { "Day {day}": "Tag {day}", Hammers: "Hämmer", Skills: "Fähigkeiten" };
  const t = (english: string, values: Record<string, string | number> = {}) =>
    (words[english] ?? english).replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
  const plan = { title: "Day 1 – Hammers, Skills", startsAt: "2026-10-20T10:00:00Z", activities: ["hammers", "skillSummons"] as const };
  assert.equal(displaySnipeTitle(plan, t), "Tag 1 – Hämmer, Fähigkeiten");
  // Listed the way the member's language reads.
  assert.equal(displaySnipeTitle(plan, t, "de"), "Tag 1 – Hämmer und Fähigkeiten");
  const english = (text: string, values: Record<string, string | number> = {}) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
  assert.equal(displaySnipeTitle(plan, english, "en"), "Day 1 – Hammers, Skills");
  assert.equal(displaySnipeTitle({ ...plan, title: "Snipe vs Akatsuki" }, t), "Snipe vs Akatsuki");
});

test("snipes start 30 to 5 minutes before the day's reset, and end at the reset", () => {
  assert.deepEqual([...RESET_LEAD_MINUTES], [30, 25, 20, 15, 10, 5]);
  assert.equal(beforeResetTime(30), "23:30");
  assert.equal(beforeResetTime(5), "23:55");
  // Day 3 (Thursday), 15 minutes before it resets at 00:00 UTC on Friday.
  const start = nextSnipeStart(3, beforeResetTime(15), thursdayMorning);
  assert.equal(start.toISOString(), "2026-10-22T23:45:00.000Z");
  assert.equal(snipeDay(start.toISOString()), 3);
  assert.equal(minutesBeforeReset(start.toISOString()), 15);
  assert.equal(minutesBeforeReset("2026-10-22T10:00:00.000Z"), null, "an older snipe at another time");
  // Late on Day 3, 30 minutes before reset has passed: the next war's Day 3. Five minutes before hasn't.
  const lateThursday = new Date("2026-10-22T23:40:00Z");
  assert.equal(nextSnipeStart(3, beforeResetTime(30), lateThursday).toISOString(), "2026-10-29T23:30:00.000Z");
  assert.equal(nextSnipeStart(3, beforeResetTime(5), lateThursday).toISOString(), "2026-10-22T23:55:00.000Z");
  // The calendar event runs until the reset.
  const text = { summary: "Turmoil snipe: Day 3", description: "Check in" };
  assert.match(snipeCalendarFile({ id: "x", startsAt: start.toISOString() }, text, "https://hub"), /DTSTART:20261022T234500Z\r\nDTEND:20261023T000000Z/);
  assert.match(googleCalendarLink({ startsAt: start.toISOString() }, text), /dates=20261022T234500Z%2F20261023T000000Z/);
});
