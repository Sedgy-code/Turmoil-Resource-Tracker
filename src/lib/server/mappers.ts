import type { Member, ResourceEntry } from "../types";
import { EMPTY_RESOURCES, type ResourceValues } from "../resources";

export function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}
export function memberFromRow(row: Record<string, unknown>): Member {
  return {
    id: String(row.id),
    discordId: String(row.discord_id),
    username: String(row.username),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    role: row.role as Member["role"],
    active: row.active === true,
    lastUpdatedAt: iso(row.last_updated_at),
    joinedAt: iso(row.joined_at)!,
  };
}
export function entryFromRow(row: Record<string, unknown>): ResourceEntry {
  const values =
    typeof row.resources === "string"
      ? JSON.parse(row.resources)
      : row.resources;
  const week =
    row.week_start instanceof Date
      ? row.week_start.toISOString().slice(0, 10)
      : String(row.week_start).slice(0, 10);
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    week,
    resources: { ...EMPTY_RESOURCES, ...(values as ResourceValues) },
    notes: String(row.notes),
    updatedAt: iso(row.updated_at)!,
    updatedBy: {
      id: String(row.updated_by),
      username: String(row.updated_by_username ?? "Clan member"),
    },
  };
}
