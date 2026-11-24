import type { EarlySpendRequest, EarlySpendStatus, ResetZone, SpendResource } from "../types";
import type { SqlConnection } from "./db";
import { iso, memberFromRow } from "./mappers";

/*
 * Early spend requests as stored: one per member, clan day and line. Shared by the spending order
 * (which marks approved members) and early-spend.ts (asking, deciding and the Discord messages).
 */

function zoneValue(value: unknown): ResetZone | null {
  const zone = (typeof value === "string" ? JSON.parse(value) : value) as ResetZone | null;
  return zone && typeof zone.name === "string" && typeof zone.from === "number" && typeof zone.to === "number" ? zone : null;
}

export function earlyFromRow(row: Record<string, unknown>): EarlySpendRequest {
  return {
    id: String(row.id),
    week: String(row.war_week_text).slice(0, 10),
    day: Number(row.war_day),
    resource: String(row.resource) as SpendResource,
    member: memberFromRow(Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith("m_")).map(([key, value]) => [key.slice(2), value]))),
    status: String(row.status) as EarlySpendStatus,
    spendAt: iso(row.spend_at),
    reason: String(row.reason ?? ""),
    place: row.place === null || row.place === undefined ? null : Number(row.place),
    points: Number(row.points ?? 0),
    zone: zoneValue(row.zone),
    snipeAt: iso(row.snipe_at) ?? "",
    night: row.night === true,
    requestedAt: iso(row.requested_at) ?? "",
    decidedBy: row.decided_by_name ? String(row.decided_by_name) : null,
    decidedAt: iso(row.decided_at),
  };
}

// The member's columns come back with an "m_" prefix (both tables have an id).
const MEMBER_COLUMNS = ["id", "discord_id", "username", "display_name", "avatar_url", "role", "active", "last_updated_at", "joined_at",
  "badge", "cosmetic_title", "cosmetic_accent", "cosmetic_frame", "never_signed_in", "holiday_until"].map((column) => `m.${column} AS m_${column}`).join(", ");
const SELECT = `SELECT e.*, e.war_week::text AS war_week_text, ${MEMBER_COLUMNS},
    COALESCE(NULLIF(d.display_name, ''), d.username) AS decided_by_name
  FROM early_spends e JOIN app_members m ON m.id = e.member_id LEFT JOIN app_members d ON d.id = e.decided_by`;

/** A war's requests, newest first (cancelled ones are left out). */
export async function earlySpendsFor(connection: SqlConnection, week: string): Promise<EarlySpendRequest[]> {
  const rows = await connection.query(`${SELECT} WHERE e.war_week = $1 AND e.status <> 'cancelled' ORDER BY e.requested_at DESC, e.id`, [week]);
  return rows.map(earlyFromRow);
}

export async function earlySpend(connection: SqlConnection, id: string): Promise<(EarlySpendRequest & { noticeChannelId: string; noticeMessageId: string }) | null> {
  const rows = await connection.query(`${SELECT} WHERE e.id = $1`, [id]);
  return rows[0] ? { ...earlyFromRow(rows[0]), noticeChannelId: String(rows[0].notice_channel_id ?? ""), noticeMessageId: String(rows[0].notice_message_id ?? "") } : null;
}
