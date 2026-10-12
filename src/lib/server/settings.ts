import { DEFAULT_WAR_RATES } from "../war";
import type { ClanSettings, Member } from "../types";
import { database, lockAdministration, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";

export const DEFAULT_SETTINGS: ClanSettings = { capacity: 50, warRates: DEFAULT_WAR_RATES };

export async function getSettings(_actor?: Member, db?: SqlConnection): Promise<ClanSettings> {
  const connection = db ?? await database();
  const rows = await connection.query("SELECT capacity,war_rates FROM clan_settings WHERE id='clan'");
  if (!rows.length) return { capacity: 50, warRates: { ...DEFAULT_WAR_RATES } };
  const rates = typeof rows[0].war_rates === "string" ? JSON.parse(rows[0].war_rates) : rows[0].war_rates;
  return { capacity: Number(rows[0].capacity), warRates: { ...DEFAULT_WAR_RATES, ...(rates as ClanSettings["warRates"]) } };
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
    await tx.query("INSERT INTO clan_settings(id,capacity,war_rates) VALUES('clan',$1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET capacity=EXCLUDED.capacity,war_rates=EXCLUDED.war_rates", [settings.capacity, JSON.stringify(settings.warRates)]);
    return settings;
  });
}
