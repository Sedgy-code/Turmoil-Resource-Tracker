import { currentWeek } from "../resources";
import type { HoardingLevel, HoardingReason, HoardingResponse, HoardingRow, HoardingRules, Member, ResourceEntry, WarRates, WarSpendingResponse, WarSpendingRow } from "../types";
import { estimateWar, WAR_ACTIVITIES } from "../war";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { entryFromRow, iso, memberFromRow } from "./mappers";
import { getSettings } from "./settings";

const DAY = 24 * 60 * 60 * 1000;
/** How far back "recent" growth is measured. */
const GROWTH_WINDOW = 28 * DAY;
/** How far back spending and snipes are looked at. */
const ACTIVITY_WINDOW = 56 * DAY;
/** A drop of at least this share of the previous value counts as spending. */
const SPEND_THRESHOLD = 0.05;
/** Admin-adjustable: when does saving become hoarding? */
export const DEFAULT_HOARDING_RULES: HoardingRules = { largeMultiple: 2, spendPercent: 10, wars: 2 };

export async function hoardingRules(connection: SqlConnection): Promise<HoardingRules> {
  const rows = await connection.query("SELECT large_multiple, spend_percent, wars FROM hoarding_rules WHERE id = 'clan'");
  if (!rows.length) return { ...DEFAULT_HOARDING_RULES };
  return { largeMultiple: Number(rows[0].large_multiple), spendPercent: Number(rows[0].spend_percent), wars: Number(rows[0].wars) };
}

export async function saveHoardingRules(actor: Member, rules: HoardingRules, db?: Database): Promise<HoardingRules> {
  const connection = db ?? await database();
  await requireAdmin(connection, actor.id);
  await connection.query(`INSERT INTO hoarding_rules (id, large_multiple, spend_percent, wars) VALUES ('clan', $1, $2, $3)
    ON CONFLICT (id) DO UPDATE SET large_multiple = EXCLUDED.large_multiple, spend_percent = EXCLUDED.spend_percent, wars = EXCLUDED.wars`,
  [rules.largeMultiple, rules.spendPercent, rules.wars]);
  return hoardingRules(connection);
}
const STALE_AFTER = 14 * DAY;

async function requireAdmin(connection: SqlConnection, actorId: string): Promise<Member> {
  const rows = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actorId]);
  if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
  const actor = memberFromRow(rows[0]);
  if (actor.role !== "ADMIN") throw new ApiError(403, "Only administrators can see the hoarding watch.", "ADMIN_REQUIRED");
  return actor;
}

/** Estimated war points everything a member holds is worth: one number to compare members by. */
function warValue(entry: ResourceEntry, rates: WarRates): number {
  try {
    return estimateWar([entry], rates, WAR_ACTIVITIES.map(({ key }) => key)).minimum;
  } catch {
    return 0;
  }
}

function median(values: number[]): number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function versionEntry(row: Record<string, unknown>): ResourceEntry {
  return entryFromRow({ ...row, id: `version:${row.id}`, week_start: currentWeek(new Date(iso(row.updated_at)!)) });
}

/**
 * Saving is fine; hoarding is holding a lot, growing it, AND not using it in wars.
 * A "good saver" keeps at least a typical member's pile and uses it in wars ("spendsInWars" is only
 * given to members holding at least the typical amount).
 */
export function hoardingLevel(reasons: HoardingReason[]): HoardingLevel {
  const large = reasons.includes("large");
  if (large && reasons.includes("growing") && reasons.includes("noWarSpending")) return "high";
  if (reasons.includes("spendsInWars")) return "saver";
  if (large && (reasons.includes("growing") || reasons.includes("noWarSpending") || reasons.includes("skipsSnipes"))) return "watch";
  return "ok";
}

export async function hoardingReport(actor: Member, db?: Database, now = new Date()): Promise<HoardingResponse> {
  const connection = db ?? await database();
  await requireAdmin(connection, actor.id);
  const settings = await getSettings(undefined, connection);
  const memberRows = await connection.query("SELECT * FROM app_members WHERE active = TRUE ORDER BY LOWER(COALESCE(NULLIF(display_name, ''), username)), id");
  const members = memberRows.map(memberFromRow);
  const ids = new Set(members.map((member) => member.id));
  const bankRows = await connection.query("SELECT * FROM member_banks");
  const versionRows = await connection.query("SELECT * FROM bank_versions ORDER BY member_id, updated_at, id");
  const since = new Date(now.getTime() - ACTIVITY_WINDOW).toISOString();
  // Only snipes where admins ticked somebody count, so unticked snipes don't make everyone look absent.
  const countedSnipes = `SELECT plan.id FROM snipe_plans plan
    WHERE plan.starts_at >= $1 AND plan.starts_at <= $2
      AND EXISTS (SELECT 1 FROM snipe_attendance attendance WHERE attendance.snipe_id = plan.id)`;
  const window = [since, now.toISOString()];
  const snipeIds = (await connection.query(countedSnipes, window)).map((row) => String(row.id));
  const responseRows = await connection.query(`SELECT snipe_id, member_id FROM snipe_responses
    WHERE answer = 'yes' AND snipe_id IN (${countedSnipes})`, window);
  const attendanceRows = await connection.query(`SELECT snipe_id, member_id FROM snipe_attendance
    WHERE snipe_id IN (${countedSnipes})`, window);
  const noteRows = await connection.query(`SELECT note.member_id, note.note, note.updated_at,
      COALESCE(NULLIF(editor.display_name, ''), editor.username) AS updated_by_username
    FROM member_admin_notes note JOIN app_members editor ON editor.id = note.updated_by`);

  const banks = new Map(bankRows.map((row) => [String(row.member_id), entryFromRow({ ...row, id: `bank:${row.member_id}`, week_start: currentWeek() })]));
  const versions = new Map<string, ResourceEntry[]>();
  for (const row of versionRows) {
    const memberId = String(row.member_id);
    if (!ids.has(memberId)) continue;
    versions.set(memberId, [...(versions.get(memberId) ?? []), versionEntry(row)]);
  }
  const notes = new Map(noteRows.map((row) => [String(row.member_id), row]));
  const values = new Map(members.map((member) => [member.id, banks.has(member.id) ? warValue(banks.get(member.id)!, settings.warRates) : 0]));
  const typical = median([...values.values()]);
  const rules = await hoardingRules(connection);
  // How much of their pile each member used in the last few wars: the war points they scored (from
  // the end-of-war results) against what their pile was worth when the war started. Scoring war
  // points is spending, so this holds even when a member earns more during the week than they use.
  const warWeeks = (await connection.query("SELECT DISTINCT week_start::text AS week FROM war_results WHERE kind = 'war' ORDER BY week DESC LIMIT $1", [rules.wars]))
    .map((row) => String(row.week).slice(0, 10));
  const scoredInWar = new Map<string, Map<string, number>>();
  for (const week of warWeeks) {
    const rows = await connection.query(`SELECT points.member_id, SUM(points.points) AS points FROM war_result_points points
      JOIN war_results result ON result.id = points.result_id
      WHERE result.week_start = $1 AND result.kind = 'war' AND points.member_id IS NOT NULL GROUP BY points.member_id`, [week]);
    scoredInWar.set(week, new Map(rows.map((row) => [String(row.member_id), Number(row.points)])));
  }
  /** Their pile when the war started: the last save before Day 1, or their first save during the war week. */
  const pileAtWar = (history: { at: number; value: number }[], week: string) => {
    const start = new Date(`${week}T00:00:00Z`).getTime() + DAY;
    const before = [...history].reverse().find((point) => point.at < start);
    return before ?? history.find((point) => point.at >= start && point.at < start + 6 * DAY) ?? null;
  };

  const rows: HoardingRow[] = members.map((member) => {
    const value = values.get(member.id) ?? 0;
    const bank = banks.get(member.id);
    const history = (versions.get(member.id) ?? []).map((entry) => ({ at: new Date(entry.updatedAt).getTime(), value: warValue(entry, settings.warRates) }));
    const growthStart = now.getTime() - GROWTH_WINDOW;
    const baseline = [...history].reverse().find((point) => point.at <= growthStart) ?? history[0];
    const trackedDays = history.length ? (now.getTime() - history[0].at) / DAY : 0;
    let lastSpendAt: number | null = null;
    let spendsRecently = 0;
    for (let index = 1; index < history.length; index++) {
      const before = history[index - 1].value;
      const after = history[index].value;
      if (before > 0 && after < before * (1 - SPEND_THRESHOLD)) {
        lastSpendAt = history[index].at;
        if (history[index].at >= now.getTime() - ACTIVITY_WINDOW) spendsRecently++;
      }
    }
    const change = baseline && history.length > 1 ? value - baseline.value : null;
    const saidYes = responseRows.filter((row) => String(row.member_id) === member.id).length;
    const attended = attendanceRows.filter((row) => String(row.member_id) === member.id).length;
    const lastSavedAt = bank?.updatedAt ?? null;
    const reasons: HoardingReason[] = [];
    if (typical > 0 && value >= typical * rules.largeMultiple) reasons.push("large");
    if (change !== null && change > 0 && trackedDays >= 14 && (lastSpendAt === null || lastSpendAt < growthStart) && value >= typical) reasons.push("growing");
    if (snipeIds.length >= 2 && attended === 0 && value >= typical) reasons.push("skipsSnipes");
    let pile = 0;
    let scored = 0;
    for (const week of warWeeks) {
      const atWar = pileAtWar(history, week);
      if (!atWar || atWar.value <= 0) continue;
      pile += atWar.value;
      scored += scoredInWar.get(week)?.get(member.id) ?? 0;
    }
    const usedShare = pile > 0 ? scored / pile : null;
    if (usedShare !== null) {
      // Using it in wars makes a good saver only for those who keep at least a typical pile.
      if (usedShare * 100 < rules.spendPercent) reasons.push("noWarSpending");
      else if (typical > 0 && value >= typical) reasons.push("spendsInWars");
    }
    if (!lastSavedAt || now.getTime() - new Date(lastSavedAt).getTime() > STALE_AFTER) reasons.push("stale");
    const note = notes.get(member.id);
    return {
      member,
      warValue: value,
      timesTypical: typical > 0 ? value / typical : null,
      change,
      trackedWeeks: Math.floor(trackedDays / 7),
      spendsRecently,
      lastSpendAt: lastSpendAt === null ? null : new Date(lastSpendAt).toISOString(),
      snipes: { held: snipeIds.length, saidYes, attended },
      lastSavedAt,
      // Scoring more than the whole pile (they earned more during the war) shows as 100%.
      warUsePercent: usedShare === null ? null : Math.min(100, Math.round(usedShare * 1000) / 10),
      reasons,
      level: hoardingLevel(reasons),
      note: note ? String(note.note) : "",
      noteUpdatedAt: note ? iso(note.updated_at) : null,
      noteBy: note ? String(note.updated_by_username) : null,
    };
  });
  const order: Record<HoardingLevel, number> = { high: 0, watch: 1, saver: 2, ok: 3 };
  rows.sort((a, b) => order[a.level] - order[b.level] || b.warValue - a.warValue);
  return { typicalWarValue: typical, rows, rules, measuredWars: warWeeks.length, generatedAt: now.toISOString() };
}

export async function saveHoardingNote(actor: Member, input: { memberId: string; note: string }, db?: Database): Promise<{ note: string }> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    const admin = await requireAdmin(tx, actor.id);
    const note = input.note.trim().slice(0, 1000);
    const target = await tx.query("SELECT id FROM app_members WHERE id = $1", [input.memberId]);
    if (!target.length) throw new ApiError(404, "This member could not be found.", "MEMBER_NOT_FOUND");
    if (!note) {
      await tx.query("DELETE FROM member_admin_notes WHERE member_id = $1", [input.memberId]);
      return { note: "" };
    }
    await tx.query(`INSERT INTO member_admin_notes (member_id, note, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
      ON CONFLICT (member_id) DO UPDATE SET note = EXCLUDED.note, updated_at = NOW(), updated_by = EXCLUDED.updated_by`, [input.memberId, note, admin.id]);
    return { note };
  });
}

/**
 * What each member saved or spent during one war week: holdings (as estimated war points) from
 * their last save before the week began, compared with their latest save up to the end of the
 * following week (members often update a day or two after a war ends).
 */
export async function warSpending(actor: Member, week: string, db?: Database, now = new Date()): Promise<WarSpendingResponse> {
  const connection = db ?? await database();
  await requireAdmin(connection, actor.id);
  const warWeek = currentWeek(new Date(`${week}T12:00:00Z`));
  // The war's Day 1 is the Tuesday after the war week's Monday; holdings before it are "before".
  const start = new Date(new Date(`${warWeek}T00:00:00Z`).getTime() + DAY);
  const settleBy = new Date(Math.min(now.getTime(), start.getTime() + 14 * DAY));
  const settings = await getSettings(undefined, connection);
  const members = (await connection.query("SELECT * FROM app_members WHERE active = TRUE ORDER BY LOWER(COALESCE(NULLIF(display_name, ''), username)), id")).map(memberFromRow);
  const versionRows = await connection.query("SELECT * FROM bank_versions WHERE updated_at <= $1 ORDER BY member_id, updated_at, id", [settleBy.toISOString()]);
  const versions = new Map<string, ResourceEntry[]>();
  for (const row of versionRows) versions.set(String(row.member_id), [...(versions.get(String(row.member_id)) ?? []), versionEntry(row)]);
  const warRows = await connection.query(`SELECT points.member_id, SUM(points.points) AS points FROM war_result_points points
    JOIN war_results result ON result.id = points.result_id
    WHERE result.week_start = $1 AND result.kind = 'war' AND points.member_id IS NOT NULL GROUP BY points.member_id`, [warWeek]);
  const warPoints = new Map(warRows.map((row) => [String(row.member_id), Number(row.points)]));
  const weekRows = await connection.query("SELECT DISTINCT week_start::text AS week FROM war_results WHERE kind = 'war' ORDER BY week DESC");
  const rows: WarSpendingRow[] = members.map((member) => {
    const history = versions.get(member.id) ?? [];
    const before = [...history].reverse().find((entry) => new Date(entry.updatedAt) < start);
    const after = [...history].reverse().find((entry) => new Date(entry.updatedAt) >= start);
    const beforeValue = before ? warValue(before, settings.warRates) : null;
    const afterValue = after ? warValue(after, settings.warRates) : null;
    return {
      member,
      before: beforeValue,
      after: afterValue,
      spent: beforeValue !== null && afterValue !== null ? beforeValue - afterValue : null,
      warPoints: warPoints.get(member.id) ?? null,
      savedAfterAt: after?.updatedAt ?? null,
    };
  });
  return { week: warWeek, warWeeks: weekRows.map((row) => String(row.week)), rows };
}
