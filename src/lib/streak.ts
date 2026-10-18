import { currentWeek, shiftWeek } from "./resources";

export interface SavingStreak {
  /** Clan weeks in a row with a complete save, up to this week (this week counts once saved). */
  weeks: number;
  /** The longest run so far. */
  best: number;
}

/**
 * A forgiving weekly streak: each clan week with a complete save adds one. A week the member was
 * away neither adds nor breaks it, and this week can't break it until it's over.
 */
export function savingStreak(savedWeeks: Iterable<string>, awayWeeks: Iterable<string>, thisWeek: string): SavingStreak {
  const saved = new Set(savedWeeks);
  const away = new Set(awayWeeks);
  const earliest = [...saved].sort()[0];
  if (!earliest) return { weeks: 0, best: 0 };
  let weeks = 0;
  for (let week = saved.has(thisWeek) ? thisWeek : shiftWeek(thisWeek, -1); week >= earliest; week = shiftWeek(week, -1)) {
    if (saved.has(week)) weeks++;
    else if (!away.has(week)) break;
  }
  let best = 0;
  let run = 0;
  for (let week = earliest; week <= thisWeek; week = shiftWeek(week, 1)) {
    if (saved.has(week)) best = Math.max(best, ++run);
    else if (!away.has(week) && week !== thisWeek) run = 0;
  }
  return { weeks, best: Math.max(best, weeks) };
}

/**
 * The clan weeks a member was away, from their holiday history: each "holiday" runs from when it
 * was set until its date, or until "holiday-ended" if that came first.
 */
export function awayWeeksFrom(events: { kind: string; detail: string; at: string }[]): string[] {
  const weeks = new Set<string>();
  const add = (from: string, to: string) => {
    if (to < from) return;
    for (let week = currentWeek(new Date(`${from}T12:00:00Z`)); week <= to; week = shiftWeek(week, 1)) weeks.add(week);
  };
  let open: { from: string; to: string } | null = null;
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const day = event.at.slice(0, 10);
    if (event.kind === "holiday") {
      if (open) add(open.from, day < open.to ? day : open.to);
      const until = event.detail.slice(0, 10);
      open = /^\d{4}-\d{2}-\d{2}$/.test(until) ? { from: day, to: until } : null;
    } else if (event.kind === "holiday-ended" && open) {
      add(open.from, day < open.to ? day : open.to);
      open = null;
    }
  }
  if (open) add(open.from, open.to);
  return [...weeks];
}
