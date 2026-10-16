import { TECH_NODES } from "../clan-tech";
import type { Member } from "../types";
import { database, type Database } from "./db";
import { ApiError } from "./errors";
import { iso } from "./mappers";

export interface ClanTechResponse { levels: Record<string, number>; updatedAt: string | null; canEdit: boolean }

export async function loadClanTech(actor: Member, db?: Database): Promise<ClanTechResponse> {
  const connection = db ?? await database();
  const rows = await connection.query("SELECT node_key, level, updated_at FROM clan_tech_levels");
  const me = await connection.query("SELECT role FROM app_members WHERE id = $1 AND active = TRUE", [actor.id]);
  const latest = rows.map((row) => iso(row.updated_at)!).sort().pop() ?? null;
  return { levels: Object.fromEntries(rows.map((row) => [String(row.node_key), Number(row.level)])), updatedAt: latest, canEdit: me[0]?.role === "ADMIN" };
}

/** Admins: set node levels (several at once), or reset everything for a new season. */
export async function saveClanTech(actor: Member, input: { levels?: Record<string, number>; reset?: boolean }, db?: Database): Promise<ClanTechResponse> {
  const connection = db ?? await database();
  const me = await connection.query("SELECT role FROM app_members WHERE id = $1 AND active = TRUE", [actor.id]);
  if (me[0]?.role !== "ADMIN") throw new ApiError(403, "Only administrators can update the Clan Tech tree.", "ADMIN_REQUIRED");
  await connection.transaction(async (tx) => {
    if (input.reset) await tx.query("UPDATE clan_tech_levels SET level = 0, updated_at = NOW(), updated_by = $1", [actor.id]);
    for (const [key, value] of Object.entries(input.levels ?? {})) {
      const entry = TECH_NODES.find((candidate) => candidate.key === key);
      if (!entry) throw new ApiError(400, "Unknown Clan Tech node.", "UNKNOWN_NODE");
      const level = Math.max(0, Math.min(entry.max, Math.round(value)));
      await tx.query(`INSERT INTO clan_tech_levels (node_key, level, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
        ON CONFLICT (node_key) DO UPDATE SET level = EXCLUDED.level, updated_at = NOW(), updated_by = EXCLUDED.updated_by`, [key, level, actor.id]);
    }
  });
  return loadClanTech(actor, connection);
}
