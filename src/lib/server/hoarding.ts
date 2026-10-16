import { currentWeek } from "../resources";
import type { HoardingLevel, HoardingReason, HoardingResponse, HoardingRow, Member, ResourceEntry, WarRates } from "../types";
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
/** Holding at least this many times the clan's typical member counts as a large stockpile. */
const LARGE_MULTIPLE = 2;
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

export function hoardingLevel(reasons: HoardingReason[]): HoardingLevel {
  const large = reasons.includes("large");
  const pattern = reasons.includes("growing") || reasons.includes("skipsSnipes");
  if (large && pattern) return "high";
  if (large || pattern) return "watch";
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
    if (typical > 0 && value >= typical * LARGE_MULTIPLE) reasons.push("large");
    if (change !== null && change > 0 && trackedDays >= 14 && (lastSpendAt === null || lastSpendAt < growthStart) && value >= typical) reasons.push("growing");
    if (snipeIds.length >= 2 && attended === 0 && value >= typical) reasons.push("skipsSnipes");
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
      reasons,
      level: hoardingLevel(reasons),
      note: note ? String(note.note) : "",
      noteUpdatedAt: note ? iso(note.updated_at) : null,
      noteBy: note ? String(note.updated_by_username) : null,
    };
  });
  const order: Record<HoardingLevel, number> = { high: 0, watch: 1, ok: 2 };
  rows.sort((a, b) => order[a.level] - order[b.level] || b.warValue - a.warValue);
  return { typicalWarValue: typical, rows, generatedAt: now.toISOString() };
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
