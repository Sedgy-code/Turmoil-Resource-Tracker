import type { Member, ResourceEntry } from "../types";
import { cosmeticItem } from "../dew";
import { normalizeResources, EMPTY_SUMMONING_COSTS, EMPTY_PLANNING_DETAILS, type SummoningCosts, type PlanningDetails } from "../resources";

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
    username: String(row.display_name || row.username),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    role: row.role as Member["role"],
    active: row.active === true,
    lastUpdatedAt: iso(row.last_updated_at),
    joinedAt: iso(row.joined_at)!,
    badge: cosmeticItem(row.badge, "badge")?.id ?? null,
    cosmetics: {
      badge: cosmeticItem(row.badge, "badge")?.id ?? null,
      title: cosmeticItem(row.cosmetic_title, "title")?.id ?? null,
      accent: cosmeticItem(row.cosmetic_accent, "accent")?.id ?? null,
      frame: cosmeticItem(row.cosmetic_frame, "frame")?.id ?? null,
    },
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
  const summoningCosts =
    typeof row.summoning_costs === "string"
      ? JSON.parse(row.summoning_costs)
      : row.summoning_costs;
  const planningDetails = typeof row.planning_details === "string" ? JSON.parse(row.planning_details) : row.planning_details;
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    week,
    resources: normalizeResources(values),
    summoningCosts: { ...EMPTY_SUMMONING_COSTS, ...(summoningCosts as SummoningCosts) },
    planningDetails: { ...EMPTY_PLANNING_DETAILS, ...(planningDetails as PlanningDetails) },
    notes: String(row.notes),
    updatedAt: iso(row.updated_at)!,
    updatedBy: {
      id: String(row.updated_by),
      username: String(row.updated_by_username ?? "Clan member"),
    },
  };
}
