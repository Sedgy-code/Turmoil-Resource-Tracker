import { DAY_ACTIVITIES } from "./clan-day-planner";
import type { WarActivity } from "./types";
import { warDay, warStart } from "./war-calendar";

const DAY = 86_400_000;

/** Snipes happen on the spending days; Day 6 is the battle and Day 7 the claim. */
export const SNIPE_DAYS = [1, 2, 3, 4, 5] as const;

/** What each war day's snipe can score with (the same as the clan-day planner). */
export function snipeDayActivities(day: number): WarActivity[] {
  return [...(DAY_ACTIVITIES[day] ?? [])];
}

/** The short names a snipe's title uses, in this order. */
const TITLE_PARTS: readonly { label: string; activities: readonly WarActivity[] }[] = [
  { label: "Hammers", activities: ["hammers"] },
  { label: "Skills", activities: ["skillSummons"] },
  { label: "Mounts", activities: ["mountSummons", "newMountMerges", "mountMerges"] },
  { label: "Pets", activities: ["eggMerges", "eggSummonMerges"] },
];

type Translate = (english: string, values?: Record<string, string | number>) => string;

/**
 * "Day 3 – Hammers, Skills, Pets". Saved in English (Discord posts are English); pass the member's
 * translate function and language to show it in their language, listed the way it reads there.
 */
export function snipeTitle(day: number, activities: readonly WarActivity[], t?: Translate, language?: string): string {
  const parts = TITLE_PARTS.filter((part) => part.activities.some((activity) => activities.includes(activity))).map((part) => (t ? t(part.label) : part.label));
  const dayText = t ? t("Day {day}", { day }) : `Day ${day}`;
  if (!parts.length) return dayText;
  let list = parts.join(", ");
  if (t && language && !language.startsWith("en")) {
    try { list = new Intl.ListFormat(language, { type: "conjunction" }).format(parts); } catch { /* keep commas */ }
  }
  return `${dayText} – ${list}`;
}

/** Which war day (1–5) a snipe starts on, or null for the battle and claim days. */
export function snipeDay(startsAt: string): number | null {
  const { day } = warDay(new Date(startsAt));
  return day <= 5 ? day : null;
}

/** The next time war Day `day` at `time` (HH:MM, UTC) comes round: this war if it's still ahead, else the next. */
export function nextSnipeStart(day: number, time: string, now = new Date()): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const start = warStart(now).getTime() + (day - 1) * DAY + ((hours || 0) * 60 + (minutes || 0)) * 60_000;
  return new Date(start > now.getTime() ? start : start + 7 * DAY);
}

/** A snipe's title in the member's language when the Hub wrote it; a leader's own title stays as it is. */
export function displaySnipeTitle(plan: { title: string; startsAt: string; activities: readonly WarActivity[] }, t: Translate, language?: string): string {
  const day = snipeDay(plan.startsAt);
  return day && plan.title === snipeTitle(day, plan.activities) ? snipeTitle(day, plan.activities, t, language) : plan.title;
}
