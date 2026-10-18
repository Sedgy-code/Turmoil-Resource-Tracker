import { randomUUID } from "node:crypto";
import type { Member, MemberHistoryEvent, MemberHistoryResponse } from "../types";
import { numberFormat } from "../resources";
import { database, lockAdministration, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { iso, memberFromRow } from "./mappers";

export async function requireAdmin(connection: SqlConnection, actorId: string): Promise<Member> {
  const rows = await connection.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actorId]);
  if (!rows.length || rows[0].role !== "ADMIN") throw new ApiError(403, "Only administrators can do this.", "ADMIN_REQUIRED");
  return memberFromRow(rows[0]);
}

async function findMember(connection: SqlConnection, memberId: string): Promise<Member> {
  const rows = await connection.query("SELECT * FROM app_members WHERE id = $1", [memberId]);
  if (!rows.length) throw new ApiError(404, "Member not found.", "MEMBER_NOT_FOUND");
  return memberFromRow(rows[0]);
}

/** Active strike counts for everyone who has any. */
export async function strikeCounts(connection: SqlConnection): Promise<Map<string, number>> {
  const rows = await connection.query("SELECT member_id, COUNT(*)::int AS count FROM member_strikes WHERE removed_at IS NULL GROUP BY member_id");
  return new Map(rows.map((row) => [String(row.member_id), Number(row.count)]));
}

export type LeadershipAction =
  | { action: "strike"; reason: string }
  | { action: "remove-strike"; strikeId: string }
  | { action: "holiday"; until: string | null; reason?: string };

/** Adds or removes a strike, or sets or ends a holiday. Every change goes in the member's history. */
export async function applyLeadershipAction(actor: Member, memberId: string, input: LeadershipAction, db?: Database, now = new Date()): Promise<Member> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const admin = await requireAdmin(tx, actor.id);
    await findMember(tx, memberId);
    const event = (kind: string, detail: string) => tx.query("INSERT INTO member_events (id, member_id, kind, detail, created_at, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [randomUUID(), memberId, kind, detail.slice(0, 300), now.toISOString(), admin.id]);
    if (input.action === "strike") {
      await tx.query("INSERT INTO member_strikes (id, member_id, reason, created_at, created_by) VALUES ($1,$2,$3,$4,$5)", [randomUUID(), memberId, input.reason.slice(0, 300), now.toISOString(), admin.id]);
    } else if (input.action === "remove-strike") {
      const removed = await tx.query("UPDATE member_strikes SET removed_at = $3, removed_by = $4 WHERE id = $1 AND member_id = $2 AND removed_at IS NULL RETURNING reason",
        [input.strikeId, memberId, now.toISOString(), admin.id]);
      if (!removed.length) throw new ApiError(404, "That strike was already removed.", "STRIKE_NOT_FOUND");
      await event("strike-removed", String(removed[0].reason ?? ""));
    } else {
      const today = now.toISOString().slice(0, 10);
      if (input.until !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(input.until) || input.until < today)) throw new ApiError(400, "Pick a date from today onwards.", "INVALID_DATE");
      await tx.query("UPDATE app_members SET holiday_until = $2 WHERE id = $1", [memberId, input.until]);
      await event(input.until ? "holiday" : "holiday-ended", input.until ? `${input.until}${input.reason ? ` · ${input.reason}` : ""}` : "");
    }
    const member = await findMember(tx, memberId);
    return { ...member, strikes: (await strikeCounts(tx)).get(memberId) ?? 0 };
  });
}

/** Everything that has happened to one member, newest first. */
export async function memberHistory(actor: Member, memberId: string, db?: Database): Promise<MemberHistoryResponse> {
  const connection = db ?? await database();
  await requireAdmin(connection, actor.id);
  const member = await findMember(connection, memberId);
  const names = new Map((await connection.query("SELECT id, COALESCE(NULLIF(display_name, ''), username) AS name FROM app_members")).map((row) => [String(row.id), String(row.name)]));
  const events: MemberHistoryEvent[] = [];
  /** An event whose English sentence can be translated: {placeholders} filled from values. */
  const line = (at: string, kind: MemberHistoryEvent["kind"], template: string, values: Record<string, string> = {}, by?: string | null): MemberHistoryEvent =>
    ({ at, kind, text: template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match), template, values, ...(by !== undefined ? { by } : {}) });

  // Joining, leaving, coming back and role changes.
  const statuses = await connection.query("SELECT active, role, changed_at FROM member_status_events WHERE member_id = $1 ORDER BY changed_at, id", [memberId]);
  let previous: Record<string, unknown> | null = null;
  for (const row of statuses) {
    const at = iso(row.changed_at)!;
    if (!previous) events.push(line(at, "joined", "Joined the Clan Hub"));
    else if (previous.active !== row.active) events.push(line(at, row.active ? "returned" : "left", row.active ? "Came back" : "Left or was switched off"));
    else if (previous.role !== row.role) events.push(line(at, "role", row.role === "ADMIN" ? "Made an admin" : "No longer an admin"));
    previous = row;
  }

  const strikes = await connection.query("SELECT id, reason, created_at, created_by, removed_at FROM member_strikes WHERE member_id = $1 ORDER BY created_at DESC", [memberId]);
  // A strike's reason is the leader's own words, shown as written.
  for (const row of strikes) events.push({ at: iso(row.created_at)!, kind: "strike", text: String(row.reason || "Strike"), ...(row.reason ? {} : { template: "Strike" }), by: names.get(String(row.created_by)) ?? null, strikeId: row.removed_at ? undefined : String(row.id) });
  const logged = await connection.query("SELECT kind, detail, created_at, created_by FROM member_events WHERE member_id = $1", [memberId]);
  for (const row of logged) {
    const kind = String(row.kind) as MemberHistoryEvent["kind"];
    const at = iso(row.created_at)!;
    const by = names.get(String(row.created_by)) ?? null;
    const detail = String(row.detail ?? "");
    if (kind === "strike-removed") events.push(detail ? line(at, kind, "Strike removed: {reason}", { reason: detail }, by) : line(at, kind, "Strike removed", {}, by));
    else if (kind === "holiday") events.push(line(at, kind, "On holiday until {date}", { date: detail }, by));
    else if (kind === "holiday-ended") events.push(line(at, kind, "Back from holiday", {}, by));
    else events.push({ at, kind, text: detail, by });
  }

  const results = await connection.query(`SELECT result.kind, result.label, result.week_start::text AS week, result.created_at, SUM(point.points) AS points
    FROM war_result_points point JOIN war_results result ON result.id = point.result_id
    WHERE point.member_id = $1 GROUP BY result.id, result.kind, result.label, result.week_start, result.created_at`, [memberId]);
  for (const row of results) {
    const vials = row.kind === "vials";
    const values = { points: numberFormat(Number(row.points)), label: String(row.label ?? "") };
    events.push(line(`${row.week}T12:00:00.000Z`, vials ? "vials" : "war", vials
      ? row.label ? "Donated {points} vials · {label}" : "Donated {points} vials"
      : row.label ? "Scored {points} war points · {label}" : "Scored {points} war points", values));
  }
  const snipes = await connection.query(`SELECT plan.title, plan.starts_at FROM snipe_attendance attendance JOIN snipe_plans plan ON plan.id = attendance.snipe_id WHERE attendance.member_id = $1`, [memberId]);
  for (const row of snipes) events.push(line(iso(row.starts_at)!, "snipe", "Joined snipe: {title}", { title: String(row.title) }));
  const saves = await connection.query("SELECT week_start::text AS week, earned_at FROM dew_weekly_earnings WHERE member_id = $1 AND reason = 'resources'", [memberId]);
  for (const row of saves) events.push(line(iso(row.earned_at)!, "saved", "Saved resources for the week of {week}", { week: String(row.week) }));

  events.sort((a, b) => b.at.localeCompare(a.at));
  return {
    member: { ...member, strikes: strikes.filter((row) => !row.removed_at).length },
    strikes: strikes.filter((row) => !row.removed_at).map((row) => ({ id: String(row.id), reason: String(row.reason ?? ""), createdAt: iso(row.created_at)!, createdBy: names.get(String(row.created_by)) ?? "" })),
    events: events.slice(0, 300),
  };
}
