import { currentWeek, shiftWeek } from "../resources";
import type { ContributionRankingResponse, ContributionRow, Member, RankingMetric } from "../types";
import { database, type Database } from "./db";
import { refreshDiscordJoinDates } from "./discord-sync";
import { ApiError } from "./errors";
import { iso, memberFromRow } from "./mappers";
import { strikeCounts } from "./leadership";
import { dayStart } from "./spending-order";
import { hasBlackMark, weekBreakdown } from "./war-days";

const DAY = 86_400_000;
const RECENT_WEEKS = 8;
const RECENT_RECORDS = 4;
const NEW_MEMBER_DAYS = 14;
export const NEVER_SIGNED_IN_PENALTY = 40;
/** Points off for each recent war with a black mark (spending on days that weren't clan days), up to BLACK_MARK_CAP. */
export const BLACK_MARK_PENALTY = 5;
export const BLACK_MARK_CAP = 15;

/**
 * How much each part counts towards the score (out of 100). Parts with no data yet are left out.
 * Weekly Clan Hub updates count the most: the clan rules ask everyone to keep their numbers fresh,
 * and the war plan depends on it. Snipes count only a little: not everyone can be online for them,
 * and time zones decide a lot. "Clan days" is the share of a member's war points scored on the
 * days leadership picked. Hoarding isn't part of the score: leaders follow it on the Player Resource Management page.
 */
export const RANKING_WEIGHTS: Record<RankingMetric, number> = {
  warPoints: 25,
  vials: 25,
  updates: 30,
  clanDays: 15,
  snipes: 5,
};

/**
 * Vials: donating at least this share of what a typical donor gives earns full marks. Ascension
 * bonuses give some members 5% and others up to 60% more vials for the same play, so a member
 * doing their full share can still donate less than the top donors.
 */
export const VIALS_FULL_MARKS = 0.8;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Fill in missing Discord join dates at most this often (the nightly Discord check does the rest). */
const JOIN_DATE_REFRESH_MS = 10 * 60 * 1000;
let joinDatesRefreshedAt = 0;

/** "Days in clan" counts from when they joined the Turmoil Discord server, or the Clan Hub until that's known. */
export function clanJoinDate(member: Member): string {
  return member.discordJoinedAt ?? member.joinedAt;
}

/** Where a value sits among everyone's (0 = lowest, 1 = highest); ties share the middle. */
export function percentile(value: number, all: number[]): number {
  if (all.length <= 1) return 0.5;
  const below = all.filter((other) => other < value).length;
  const equal = all.filter((other) => other === value).length;
  return (below + (equal - 1) / 2) / (all.length - 1);
}

export async function contributionRanking(actor: Member, db?: Database, now = new Date(), options: { fetcher?: typeof fetch } = {}): Promise<ContributionRankingResponse> {
  const connection = db ?? await database();
  const actorRows = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actor.id]);
  if (!actorRows.length || memberFromRow(actorRows[0]).role !== "ADMIN") throw new ApiError(403, "Only administrators can see the contribution ranking.", "ADMIN_REQUIRED");
  const strikes = await strikeCounts(connection);
  const activeMembers = async () => (await connection.query("SELECT * FROM app_members WHERE active = TRUE")).map((row) => {
    const member = memberFromRow(row);
    return { ...member, strikes: strikes.get(member.id) ?? 0 };
  });
  let members = await activeMembers();
  // Anyone without a Discord join date yet (new since last night's check): ask Discord now.
  if (process.env.DISCORD_BOT_TOKEN && members.some((member) => !member.discordJoinedAt) && Date.now() - joinDatesRefreshedAt > JOIN_DATE_REFRESH_MS) {
    joinDatesRefreshedAt = Date.now();
    try {
      if (await refreshDiscordJoinDates({ db: connection, fetcher: options.fetcher })) members = await activeMembers();
    } catch { /* Discord unavailable: count from the Clan Hub join date for now. */ }
  }
  const thisWeek = currentWeek(now);
  const sinceWeek = shiftWeek(thisWeek, -RECENT_WEEKS);
  // Without a Discord join date, everyone who signed up in the first few days was already in the
  // clan when the site launched, so they aren't "new".
  const launch = Math.min(...members.map((member) => new Date(member.joinedAt).getTime()));
  const joinedRecently = (member: Member) => !!member.discordJoinedAt || new Date(member.joinedAt).getTime() > launch + 3 * DAY;
  const joinedAt = (member: Member) => new Date(clanJoinDate(member)).getTime();
  // Records count from when they joined; for those already here at launch (no Discord date), all of them.
  const joined = (member: Member) => joinedRecently(member) ? joinedAt(member) : -Infinity;

  // Everything counts only from when each member joined, so time in the clan neither helps nor hurts:
  // a record is theirs when it started after they joined (missing from it counts as 0), or when they
  // scored in it anyway (Discord's join date can be a few days after joining in the game).
  const recentRecords = async (kind: "war" | "vials") => {
    const records = await connection.query("SELECT id, week_start::text AS week FROM war_results WHERE kind = $1 ORDER BY week_start DESC, created_at DESC LIMIT $2", [kind, RECENT_RECORDS]);
    return Promise.all(records.map(async (record) => {
      const week = String(record.week).slice(0, 10);
      const points = new Map((await connection.query("SELECT member_id, SUM(points) AS points FROM war_result_points WHERE result_id = $1 AND member_id IS NOT NULL GROUP BY member_id", [record.id]))
        .map((row) => [String(row.member_id), Number(row.points)]));
      // A war starts on Day 1 (Tuesday); vials count from the start of the week.
      return { starts: dayStart(week, kind === "war" ? 1 : 0).getTime(), points };
    }));
  };
  const wars = await recentRecords("war");
  const vials = await recentRecords("vials");
  type WarRecord = (typeof wars)[number];
  const scored = (record: WarRecord, member: Member) => (record.points.get(member.id) ?? 0) > 0;
  const perRecord = (records: WarRecord[], member: Member) => {
    const mine = records.filter((record) => scored(record, member) || record.starts >= joined(member));
    const total = mine.reduce((sum, record) => sum + (record.points.get(member.id) ?? 0), 0);
    return { average: mine.length ? total / mine.length : null, counted: mine.length, appeared: mine.filter((record) => scored(record, member)).length };
  };

  // Weekly Clan Hub saves: the past weeks since they joined (or that they saved in anyway), plus this week once saved.
  const saves = await connection.query(`SELECT member_id, week_start::text AS week FROM dew_weekly_earnings
    WHERE reason = 'resources' AND week_start >= $1`, [sinceWeek]);
  const savedWeeks = new Map<string, Set<string>>();
  for (const row of saves) {
    const id = String(row.member_id);
    savedWeeks.set(id, (savedWeeks.get(id) ?? new Set()).add(String(row.week).slice(0, 10)));
  }
  const pastWeeks = Array.from({ length: RECENT_WEEKS }, (_, index) => shiftWeek(sinceWeek, index));
  const updatesFor = (member: Member) => {
    const saved = savedWeeks.get(member.id) ?? new Set<string>();
    const due = pastWeeks.filter((week) => saved.has(week) || Date.parse(`${week}T00:00:00Z`) >= joined(member));
    const thisWeekSaved = saved.has(thisWeek) ? 1 : 0;
    return { done: due.filter((week) => saved.has(week)).length + thisWeekSaved, due: due.length + thisWeekSaved };
  };

  // Snipes in the last 8 weeks that leaders took attendance for. Each counts for everyone who joined
  // the clan before it started, and for anyone who checked in. One that was called off counts only for
  // those who checked in before it was.
  const snipesFrom = new Date(`${sinceWeek}T00:00:00Z`).toISOString();
  const snipeRows = await connection.query(`SELECT plan.id, plan.starts_at, plan.cancelled_at IS NOT NULL AS cancelled, attendance.member_id
    FROM snipe_plans plan JOIN snipe_attendance attendance ON attendance.snipe_id = plan.id
    WHERE plan.starts_at >= $1 AND plan.starts_at <= $2`, [snipesFrom, now.toISOString()]);
  const held = new Map<string, { starts: number; cancelled: boolean }>();
  const attended = new Map<string, Set<string>>();
  for (const row of snipeRows) {
    const id = String(row.id);
    held.set(id, { starts: new Date(iso(row.starts_at)!).getTime(), cancelled: !!row.cancelled });
    const memberId = String(row.member_id);
    attended.set(memberId, (attended.get(memberId) ?? new Set()).add(id));
  }
  const snipesFor = (member: Member) => {
    const joinedSnipes = attended.get(member.id) ?? new Set<string>();
    const theirs = [...held].filter(([id, snipe]) => joinedSnipes.has(id) || (!snipe.cancelled && snipe.starts >= joined(member)));
    return { joined: joinedSnipes.size, held: theirs.length };
  };
  // Saying Yes to a snipe and not checking in costs nothing: snipes are often called off when they
  // aren't needed, so a no-show isn't held against anyone (leadership's call).

  // Spending on the clan's chosen days, from the daily war-point uploads of recent wars that had clan days picked.
  const dayWeeks = (await connection.query(`SELECT DISTINCT result.week_start::text AS week FROM war_results result
    JOIN clan_war_days chosen ON chosen.war_week = result.week_start AND chosen.days <> ''
    WHERE result.kind = 'warday' ORDER BY week DESC LIMIT $1`, [RECENT_RECORDS])).map((row) => String(row.week).slice(0, 10));
  const dayRows = new Map<string, Map<string, { on: number; other: number; mark: boolean }>>();
  for (const week of dayWeeks) {
    const breakdown = await weekBreakdown(connection, week);
    const rowsThisWeek = new Map<string, { on: number; other: number; mark: boolean }>();
    for (const row of breakdown.rows) {
      // Everyone is listed, even with nothing scored: only those who scored were there for sure.
      if (!row.memberId || row.onClanDays + row.otherDays <= 0) continue;
      const current = rowsThisWeek.get(row.memberId) ?? { on: 0, other: 0, mark: false };
      rowsThisWeek.set(row.memberId, { on: current.on + row.onClanDays, other: current.other + row.otherDays, mark: current.mark || hasBlackMark(row, breakdown.clanDays) });
    }
    dayRows.set(week, rowsThisWeek);
  }
  // Their clan-day wars: ones that started after they joined, or that they scored in. Nothing scored
  // in one of theirs counts as 0: they didn't spend on the clan days either.
  const clanDaysFor = (member: Member) => {
    const mine = dayWeeks.filter((week) => dayRows.get(week)?.has(member.id) || dayStart(week, 1).getTime() >= joined(member));
    let on = 0;
    let other = 0;
    let marks = 0;
    for (const week of mine) {
      const row = dayRows.get(week)?.get(member.id);
      if (!row) continue;
      on += row.on;
      other += row.other;
      if (row.mark) marks += 1;
    }
    return { share: mine.length ? (on + other > 0 ? on / (on + other) : 0) : null, marks };
  };

  const raw = members.map((member) => {
    const war = perRecord(wars, member);
    const vial = perRecord(vials, member);
    const update = updatesFor(member);
    const snipe = snipesFor(member);
    const days = clanDaysFor(member);
    const daysInClan = Math.max(0, Math.floor((now.getTime() - joinedAt(member)) / DAY));
    const isNew = daysInClan < NEW_MEMBER_DAYS && joinedRecently(member);
    // Settling in: their first two weeks, or no full war since they joined (when there are wars to go by).
    const fullWars = wars.filter((record) => record.starts >= joined(member)).length;
    const settling = isNew || (joinedRecently(member) && wars.length > 0 && fullWars === 0 && war.appeared === 0);
    return {
      member,
      warPoints: war.average,
      warsPlayed: war.appeared,
      warsCounted: war.counted,
      vials: vial.average,
      snipes: snipe.joined,
      snipesHeld: snipe.held,
      updates: update.done,
      updatesDue: update.due,
      clanDayShare: days.share,
      blackMarks: days.marks,
      daysInClan,
      isNew,
      settling,
      lastSavedAt: member.lastUpdatedAt,
    };
  });

  // Ranked members are compared with each other; members settling in don't move anyone's place.
  const ranked = raw.filter((row) => !row.settling);
  const valuesOf = (pick: (row: (typeof raw)[number]) => number | null) => ranked.map(pick).filter((value): value is number => value !== null);
  const warValues = valuesOf((row) => row.warPoints);
  const dayValues = valuesOf((row) => row.clanDayShare);
  // A typical donor: the middle of everyone who donated anything, per vial record.
  const typicalVials = median(valuesOf((row) => row.vials).filter((value) => value > 0));
  const partsOf = (row: (typeof raw)[number]): Partial<Record<RankingMetric, number>> => {
    const parts: Partial<Record<RankingMetric, number>> = {};
    if (row.warPoints !== null) parts.warPoints = percentile(row.warPoints, warValues);
    if (row.vials !== null) parts.vials = typicalVials > 0 ? Math.min(1, row.vials / (VIALS_FULL_MARKS * typicalVials)) : 0.5;
    // Shares of their own weeks and snipes: keeping up every week earns full marks, however long they've been here.
    if (row.updatesDue > 0) parts.updates = row.updates / row.updatesDue;
    if (row.clanDayShare !== null) parts.clanDays = percentile(row.clanDayShare, dayValues);
    if (row.snipesHeld > 0) parts.snipes = row.snipes / row.snipesHeld;
    return parts;
  };
  // The exact score, before rounding and the 0–100 limits: breaks ties such as two members at 0.
  const exact = new Map<string, number>();
  const rows: ContributionRow[] = raw.map((row) => {
    if (row.settling) return { ...row, parts: {}, penalty: 0, score: 0, rank: 0 };
    const parts = partsOf(row);
    // Parts with nothing to go by yet for this member are left out, and the rest count for more.
    const weight = (Object.keys(parts) as RankingMetric[]).reduce((sum, metric) => sum + RANKING_WEIGHTS[metric], 0);
    const base = weight ? (Object.keys(parts) as RankingMetric[]).reduce((sum, metric) => sum + (parts[metric] ?? 0) * RANKING_WEIGHTS[metric], 0) / weight * 100 : 50;
    // Never signing in to the Clan Hub at all is the biggest red flag.
    const penalty = (row.member.neverSignedIn ? NEVER_SIGNED_IN_PENALTY : 0) + Math.min(BLACK_MARK_CAP, row.blackMarks * BLACK_MARK_PENALTY);
    exact.set(row.member.id, base - penalty);
    return { ...row, parts, penalty, score: Math.min(100, Math.max(0, Math.round(base - penalty))), rank: 0 };
  });
  // Lowest scores first (who to talk to first); members settling in after everyone, newest last.
  rows.sort((a, b) => Number(a.settling) - Number(b.settling)
    || (a.settling ? b.daysInClan - a.daysInClan : (exact.get(a.member.id) ?? 0) - (exact.get(b.member.id) ?? 0) || (a.lastSavedAt ?? "").localeCompare(b.lastSavedAt ?? "")));
  let place = 0;
  for (const row of rows) if (!row.settling) row.rank = ++place;
  const available = (Object.keys(RANKING_WEIGHTS) as RankingMetric[]).filter((metric) =>
    metric === "warPoints" ? wars.length > 0 : metric === "vials" ? vials.length > 0 : metric === "clanDays" ? dayWeeks.length > 0 : metric === "snipes" ? held.size > 0 : true);
  return {
    rows,
    weights: Object.fromEntries(available.map((metric) => [metric, RANKING_WEIGHTS[metric]])) as Partial<Record<RankingMetric, number>>,
    records: { wars: wars.length, vials: vials.length },
    generatedAt: now.toISOString(),
  };
}
