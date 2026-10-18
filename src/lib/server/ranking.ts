import { currentWeek, shiftWeek } from "../resources";
import type { ContributionRankingResponse, ContributionRow, Member, RankingMetric } from "../types";
import { database, type Database } from "./db";
import { ApiError } from "./errors";
import { hoardingReport } from "./hoarding";
import { memberFromRow } from "./mappers";
import { snipeRecognition } from "./war-results";
import { strikeCounts } from "./leadership";
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
 * Snipes count only a little: not everyone can be online for them, and time zones decide a lot.
 * Clan Tech Vials and weekly Clan Hub updates count more, as the clan rules ask of everyone.
 * "Clan days" is the share of a member's war points scored on the days leadership picked.
 */
export const RANKING_WEIGHTS: Record<RankingMetric, number> = {
  warPoints: 30,
  vials: 30,
  updates: 20,
  clanDays: 15,
  snipes: 5,
};

/** Where a value sits among everyone's (0 = lowest, 1 = highest); ties share the middle. */
export function percentile(value: number, all: number[]): number {
  if (all.length <= 1) return 0.5;
  const below = all.filter((other) => other < value).length;
  const equal = all.filter((other) => other === value).length;
  return (below + (equal - 1) / 2) / (all.length - 1);
}

export async function contributionRanking(actor: Member, db?: Database, now = new Date()): Promise<ContributionRankingResponse> {
  const connection = db ?? await database();
  const actorRows = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actor.id]);
  if (!actorRows.length || memberFromRow(actorRows[0]).role !== "ADMIN") throw new ApiError(403, "Only administrators can see the contribution ranking.", "ADMIN_REQUIRED");
  const strikes = await strikeCounts(connection);
  const members = (await connection.query("SELECT * FROM app_members WHERE active = TRUE")).map((row) => {
    const member = memberFromRow(row);
    return { ...member, strikes: strikes.get(member.id) ?? 0 };
  });
  const sinceWeek = shiftWeek(currentWeek(now), -RECENT_WEEKS);

  // Last few war and vial records; missing from a record counts as 0.
  const recordTotals = async (kind: "war" | "vials") => {
    const records = await connection.query("SELECT id, week_start::text AS week FROM war_results WHERE kind = $1 ORDER BY week_start DESC, created_at DESC LIMIT $2", [kind, RECENT_RECORDS]);
    const totals = new Map<string, { sum: number; appeared: number }>();
    for (const record of records) {
      const points = await connection.query("SELECT member_id, SUM(points) AS points FROM war_result_points WHERE result_id = $1 AND member_id IS NOT NULL GROUP BY member_id", [record.id]);
      for (const row of points) {
        const current = totals.get(String(row.member_id)) ?? { sum: 0, appeared: 0 };
        totals.set(String(row.member_id), { sum: current.sum + Number(row.points), appeared: current.appeared + 1 });
      }
    }
    return { count: records.length, weeks: records.map((record) => String(record.week)), totals };
  };
  const wars = await recordTotals("war");
  const vials = await recordTotals("vials");

  const snipes = await snipeRecognition(connection, now);
  const promised = await connection.query(`SELECT response.member_id, COUNT(*)::int AS count FROM snipe_responses response
    JOIN snipe_plans plan ON plan.id = response.snipe_id
    WHERE response.answer = 'yes' AND plan.starts_at >= $1 AND plan.starts_at <= $2
      AND EXISTS (SELECT 1 FROM snipe_attendance attendance WHERE attendance.snipe_id = plan.id)
      AND NOT EXISTS (SELECT 1 FROM snipe_attendance attendance WHERE attendance.snipe_id = plan.id AND attendance.member_id = response.member_id)
    GROUP BY response.member_id`, [`${sinceWeek}T00:00:00Z`, now.toISOString()]);
  const noShows = new Map(promised.map((row) => [String(row.member_id), Number(row.count)]));
  const updates = await connection.query(`SELECT member_id, COUNT(*)::int AS count FROM dew_weekly_earnings
    WHERE reason = 'resources' AND week_start >= $1 GROUP BY member_id`, [sinceWeek]);
  const updateCounts = new Map(updates.map((row) => [String(row.member_id), Number(row.count)]));

  // Spending on the clan's chosen days, from the daily war-point uploads of recent wars that had clan days picked.
  const dayWeeks = (await connection.query(`SELECT DISTINCT result.week_start::text AS week FROM war_results result
    JOIN clan_war_days chosen ON chosen.war_week = result.week_start AND chosen.days <> ''
    WHERE result.kind = 'warday' ORDER BY week DESC LIMIT $1`, [RECENT_RECORDS])).map((row) => String(row.week).slice(0, 10));
  const onDays = new Map<string, { on: number; other: number; marks: number }>();
  for (const week of dayWeeks) {
    const breakdown = await weekBreakdown(connection, week);
    for (const row of breakdown.rows) {
      if (!row.memberId) continue;
      const current = onDays.get(row.memberId) ?? { on: 0, other: 0, marks: 0 };
      onDays.set(row.memberId, {
        on: current.on + row.onClanDays,
        other: current.other + row.otherDays,
        marks: current.marks + (hasBlackMark(row, breakdown.clanDays) ? 1 : 0),
      });
    }
  }
  // Nothing scored at all counts as 0: they didn't spend on the clan days either.
  const clanDayShare = (memberId: string) => {
    const totals = onDays.get(memberId);
    return totals && totals.on + totals.other > 0 ? totals.on / (totals.on + totals.other) : 0;
  };
  const hoarding = new Map((await hoardingReport(actor, connection, now)).rows.map((row) => [row.member.id, row.level]));

  const raw = members.map((member) => ({
    member,
    warPoints: wars.count ? (wars.totals.get(member.id)?.sum ?? 0) / wars.count : null,
    warsPlayed: wars.totals.get(member.id)?.appeared ?? 0,
    vials: vials.count ? vials.totals.get(member.id)?.sum ?? 0 : null,
    snipes: snipes.recent[member.id] ?? 0,
    noShows: noShows.get(member.id) ?? 0,
    updates: updateCounts.get(member.id) ?? 0,
    clanDays: dayWeeks.length ? clanDayShare(member.id) : null,
    clanDayShare: dayWeeks.length ? clanDayShare(member.id) : null,
    blackMarks: onDays.get(member.id)?.marks ?? 0,
    hoarding: hoarding.get(member.id) ?? "ok",
    daysInClan: Math.max(0, Math.floor((now.getTime() - new Date(member.joinedAt).getTime()) / DAY)),
    lastSavedAt: member.lastUpdatedAt,
  }));
  const available: RankingMetric[] = (Object.keys(RANKING_WEIGHTS) as RankingMetric[]).filter((metric) =>
    metric === "warPoints" ? wars.count > 0 : metric === "vials" ? vials.count > 0 : metric === "clanDays" ? dayWeeks.length > 0 : true);
  const totalWeight = available.reduce((sum, metric) => sum + RANKING_WEIGHTS[metric], 0);
  const values = (metric: RankingMetric) => raw.map((row) => Number(row[metric] ?? 0));

  // Everyone who signed up in the first few days was already in the clan when the site launched.
  const launch = Math.min(...members.map((member) => new Date(member.joinedAt).getTime()));
  const joinedAfterLaunch = (member: Member) => new Date(member.joinedAt).getTime() > launch + 3 * DAY;
  const rows: ContributionRow[] = raw.map((row) => {
    const parts = Object.fromEntries(available.map((metric) => [metric, percentile(Number(row[metric] ?? 0), values(metric))])) as Partial<Record<RankingMetric, number>>;
    const base = totalWeight ? available.reduce((sum, metric) => sum + (parts[metric] ?? 0) * RANKING_WEIGHTS[metric], 0) / totalWeight * 100 : 50;
    // Never signing in to the Clan Hub at all is the biggest red flag.
    const penalty = (row.member.neverSignedIn ? NEVER_SIGNED_IN_PENALTY : 0) + (row.hoarding === "high" ? 15 : row.hoarding === "watch" ? 5 : 0) + Math.min(15, row.noShows * 5)
      + Math.min(BLACK_MARK_CAP, row.blackMarks * BLACK_MARK_PENALTY);
    // Good savers who spend when it counts get a small bonus.
    const bonus = row.hoarding === "saver" ? 3 : 0;
    return { ...row, parts, penalty, score: Math.min(100, Math.max(0, Math.round(base - penalty + bonus))), isNew: row.daysInClan < NEW_MEMBER_DAYS && joinedAfterLaunch(row.member), rank: 0 };
  });
  rows.sort((a, b) => a.score - b.score || (a.lastSavedAt ?? "").localeCompare(b.lastSavedAt ?? ""));
  rows.forEach((row, index) => { row.rank = index + 1; });
  return {
    rows,
    weights: Object.fromEntries(available.map((metric) => [metric, RANKING_WEIGHTS[metric]])) as Partial<Record<RankingMetric, number>>,
    records: { wars: wars.count, vials: vials.count },
    generatedAt: now.toISOString(),
  };
}
