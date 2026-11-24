import { DEFAULT_WAR_RATES, warTechFromLevels } from "../war";
import type { ClanSettings, Member } from "../types";
import { database, lockAdministration, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";

export const DEFAULT_SETTINGS: ClanSettings = { capacity: 50, warRates: DEFAULT_WAR_RATES };

export async function getSettings(_actor?: Member, db?: SqlConnection): Promise<ClanSettings> {
  const connection = db ?? await database();
  // war_base_rates: the game's base points (before tech). Older saved rates had clan tech in, so are not read.
  const rows = await connection.query("SELECT capacity,war_base_rates FROM clan_settings WHERE id='clan'");
  // The Clan Tech page's levels: their war point bonuses are added to the base rates in the background.
  const tech = await connection.query("SELECT node_key, level FROM clan_tech_levels");
  const warTech = warTechFromLevels(Object.fromEntries(tech.map((row) => [String(row.node_key), Number(row.level)])));
  if (!rows.length) return { capacity: 50, warRates: { ...DEFAULT_WAR_RATES }, warTech };
  const saved = rows[0].war_base_rates;
  const rates = typeof saved === "string" ? JSON.parse(saved) : saved ?? {};
  return { capacity: Number(rows[0].capacity), warRates: { ...DEFAULT_WAR_RATES, ...(rates as ClanSettings["warRates"]) }, warTech };
}

export async function updateSettings(actor: Member, input: Partial<ClanSettings>, db?: Database): Promise<ClanSettings> {
  const connection = db ?? await database();
  return connection.transaction(async tx => {
    await lockAdministration(tx, connection.dialect);
    const members = await tx.query("SELECT role FROM app_members WHERE id=$1 AND active=TRUE FOR UPDATE", [actor.id]);
    if (!members.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
    if (members[0].role !== "ADMIN") throw new ApiError(403, "Only administrators can change clan settings.", "ADMIN_REQUIRED");
    const previous = await getSettings(undefined, tx);
    const settings = { capacity: input.capacity ?? previous.capacity, warRates: input.warRates ?? previous.warRates };
    await tx.query("INSERT INTO clan_settings(id,capacity,war_base_rates) VALUES('clan',$1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET capacity=EXCLUDED.capacity,war_base_rates=EXCLUDED.war_base_rates", [settings.capacity, JSON.stringify(settings.warRates)]);
    return { ...settings, warTech: previous.warTech };
  });
}
