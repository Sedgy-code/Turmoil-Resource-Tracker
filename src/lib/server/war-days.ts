import { warWeekOf } from "../war-calendar";
import type { ClanDaysResponse, Member, WarDayReport, WarDayRow } from "../types";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { memberFromRow } from "./mappers";
import { loadResults } from "./war-results";

/** War days where spending scores. Day 6 is the battle and Day 7 is for claiming rewards. */
export const SPENDING_DAYS = [1, 2, 3, 4, 5] as const;
/** More than this share of a member's war points on days that weren't clan days earns a black mark. */
export const OFF_DAY_LIMIT = 0.1;

async function activeMember(connection: SqlConnection, actorId: string): Promise<Member> {
  const rows = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actorId]);
  if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
  return memberFromRow(rows[0]);
}

export function parseDays(text: string): number[] {
  return [...new Set(text.split(",").map(Number).filter((day) => SPENDING_DAYS.includes(day as 1)))].sort((a, b) => a - b);
}

/** The clan days leadership picked for one war (empty when not picked yet). */
export async function clanDays(connection: SqlConnection, week: string): Promise<number[]> {
  const rows = await connection.query("SELECT days FROM clan_war_days WHERE war_week = $1", [week]);
  return rows.length ? parseDays(String(rows[0].days)) : [];
}

export async function getClanDays(actor: Member, week = warWeekOf(new Date()), db?: Database): Promise<ClanDaysResponse> {
  const connection = db ?? await database();
  await activeMember(connection, actor.id);
  return { week, days: await clanDays(connection, week) };
}

export async function setClanDays(actor: Member, input: { week: string; days: number[] }, db?: Database): Promise<ClanDaysResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    const admin = await activeMember(tx, actor.id);
    if (admin.role !== "ADMIN") throw new ApiError(403, "Only administrators can pick the clan days.", "ADMIN_REQUIRED");
    const days = parseDays(input.days.join(","));
    await tx.query(`INSERT INTO clan_war_days (war_week, days, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
      ON CONFLICT (war_week) DO UPDATE SET days = EXCLUDED.days, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [input.week, days.join(","), admin.id]);
    return { week: input.week, days };
  });
}

export function hasBlackMark(row: Pick<WarDayRow, "onClanDays" | "otherDays">, days: number[]): boolean {
  const total = row.onClanDays + row.otherDays;
  return days.length > 0 && row.otherDays > 0 && row.otherDays / total > OFF_DAY_LIMIT;
}

/**
 * Who scored on which day of one war, from the daily uploads. Points on clan days count;
 * points on other spending days are "other days". Unmatched in-game names get their own rows.
 */
export async function weekBreakdown(connection: SqlConnection, week: string) {
  const days = await clanDays(connection, week);
  const uploads = (await loadResults(connection, { kind: "warday", week }))
    .filter((upload) => upload.warDay !== null && upload.warDay >= 1 && upload.warDay <= 5)
    .sort((a, b) => (a.warDay ?? 0) - (b.warDay ?? 0));
  const rows = new Map<string, { memberId: string | null; name: string; days: (number | null)[]; onClanDays: number; otherDays: number }>();
  for (const upload of uploads) {
    for (const point of upload.points) {
      const key = point.memberId ?? `name:${point.gameName.toLowerCase()}`;
      const row = rows.get(key) ?? { memberId: point.memberId, name: point.gameName, days: SPENDING_DAYS.map(() => null), onClanDays: 0, otherDays: 0 };
      const index = (upload.warDay ?? 1) - 1;
      row.days[index] = (row.days[index] ?? 0) + point.points;
      rows.set(key, row);
    }
  }
  if (days.length) {
    for (const row of rows.values()) {
      row.days.forEach((value, index) => {
        if (!value) return;
        if (days.includes(index + 1)) row.onClanDays += value; else row.otherDays += value;
      });
    }
  }
  return { week, clanDays: days, uploads, rows: [...rows.values()] };
}

export async function warDayReport(actor: Member, week?: string, db?: Database, now = new Date()): Promise<WarDayReport> {
  const connection = db ?? await database();
  await activeMember(connection, actor.id);
  const weeks = (await connection.query("SELECT DISTINCT week_start::text AS week FROM war_results WHERE kind = 'warday' ORDER BY week DESC"))
    .map((row) => String(row.week).slice(0, 10));
  const breakdown = await weekBreakdown(connection, week ?? warWeekOf(now));
  const members = (await connection.query("SELECT * FROM app_members WHERE active = TRUE")).map(memberFromRow);
  const byId = new Map(members.map((member) => [member.id, member]));
  const rows: WarDayRow[] = breakdown.rows
    .filter((row) => !row.memberId || byId.has(row.memberId))
    .map((row) => ({
      member: row.memberId ? byId.get(row.memberId) ?? null : null,
      name: row.name,
      days: row.days,
      onClanDays: row.onClanDays,
      otherDays: row.otherDays,
      blackMark: hasBlackMark(row, breakdown.clanDays),
    }));
  // Members with nothing on any uploaded day are listed too, so leadership sees who didn't score.
  if (breakdown.uploads.length) {
    const listed = new Set(rows.map((row) => row.member?.id).filter(Boolean));
    for (const member of members) {
      if (!listed.has(member.id)) rows.push({ member, name: member.username, days: SPENDING_DAYS.map(() => null), onClanDays: 0, otherDays: 0, blackMark: false });
    }
  }
  return { week: breakdown.week, weeks, clanDays: breakdown.clanDays, uploads: breakdown.uploads, rows, offDayLimit: OFF_DAY_LIMIT };
}
