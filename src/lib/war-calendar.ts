import type { ResourceKey } from "./resources";

const DAY = 86_400_000;

/** What counts for war points on each day. Day 1 starts Tuesday 00:00 UTC; Day 7 (claim) is Monday. */
export const WAR_DAYS: readonly { day: number; activities: string[]; resources: ResourceKey[]; tip: string }[] = [
  { day: 1, activities: ["Hammers", "Dungeon keys", "Skill summons"], resources: ["hammers", "skillTickets"], tip: "Use hammers and skill tickets today." },
  { day: 2, activities: ["Forge upgrades", "Tech upgrades", "Mount summons"], resources: ["mountKeys", "mountsToMerge"], tip: "Summon and merge mounts today." },
  { day: 3, activities: ["Hammers", "Skill summons", "Egg hatching", "Pet merges"], resources: ["hammers", "skillTickets", "eggsPetsTotal", "eggshellsTotal"], tip: "Hammers, skills, eggs and pets all count today." },
  { day: 4, activities: ["Forge upgrades", "Dungeon keys", "Mount summons"], resources: ["mountKeys", "mountsToMerge"], tip: "Second mount day." },
  { day: 5, activities: ["Hammers", "Tech upgrades", "Egg hatching", "Pet merges"], resources: ["hammers", "eggsPetsTotal", "eggshellsTotal"], tip: "Last day for hammers, eggs and pets." },
  { day: 6, activities: ["Battle"], resources: [], tip: "Fight the other clans. Spending doesn't score today." },
  { day: 7, activities: ["Claim rewards"], resources: [], tip: "Claim your war rewards. You only have today." },
];

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}

/** Tuesday 00:00 UTC that started the current clan war (Day 1). */
export function warStart(now: Date): Date {
  return new Date(weekStart(new Date(now.getTime() - DAY)).getTime() + DAY);
}

/**
 * The Monday "week" a war belongs to on the Clan Hub: the Monday just before its Day 1.
 * Results uploaded on Day 7 (Monday) still count for the war that just finished.
 */
export function warWeekOf(date: Date): string {
  return weekStart(new Date(date.getTime() - DAY)).toISOString().slice(0, 10);
}

/** The war after the current one, by the Monday before its Day 1 (on Day 7 that's today). */
export function nextWarWeek(now = new Date()): string {
  return new Date(warStart(now).getTime() + 6 * DAY).toISOString().slice(0, 10);
}

/** Clan Tech Race: one week, Monday 00:00 UTC to Monday 00:00 UTC, with a knock-out every day at 00:00 UTC. */
export function raceEnd(now = new Date()): Date {
  return new Date(weekStart(now).getTime() + 7 * DAY);
}

/** Which war day it is (1–7) and when the next day starts. */
export function warDay(now = new Date()): { day: number; dayStart: Date; nextDay: Date; weekEnd: Date } {
  const start = warStart(now);
  const day = Math.min(7, Math.floor((now.getTime() - start.getTime()) / DAY) + 1);
  const dayStart = new Date(start.getTime() + (day - 1) * DAY);
  return { day, dayStart, nextDay: new Date(dayStart.getTime() + DAY), weekEnd: new Date(start.getTime() + 7 * DAY) };
}

/** The next war day (counting today if it hasn't ended) where a resource scores. */
export function nextUseDay(resource: ResourceKey, now = new Date()): number | null {
  const { day } = warDay(now);
  return WAR_DAYS.find((entry) => entry.day >= day && entry.resources.includes(resource))?.day ?? null;
}

/** A time on the clan's clock: "Wed 21 Oct, 10:00 UTC", in the member's language. */
export function utcDateTime(iso: string, language: string): string {
  const text = new Intl.DateTimeFormat(language, {
    timeZone: "UTC", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
  return `${text} UTC`;
}

/** "2d 5h", "5h 12m" or "12m". */
export function countdown(to: Date, now = new Date()): string {
  const minutes = Math.max(0, Math.round((to.getTime() - now.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
