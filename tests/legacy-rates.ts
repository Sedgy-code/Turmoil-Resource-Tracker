import type { Database } from "../src/lib/server/db";
import type { WarRates } from "../src/lib/types";

/**
 * The point rates these tests were written with: the game's base points with maxed clan tech
 * already in (225 a skill summon). The Hub's defaults are now the base points (125 a skill summon),
 * with clan tech added in the background.
 */
export const TEST_RATES: WarRates = {
  hammersMin: 2,
  hammersMax: 5,
  skillSummons: 225,
  mountSummons: 1080,
  newMountMerges: 1080,
  mountMerges: 1080,
  eggMerges: 2250,
  eggSummonMerges: 2250,
};

/** Save TEST_RATES as the clan's rates, so the server's estimates use them. */
export async function useTestRates(db: Database): Promise<void> {
  await db.query(
    "INSERT INTO clan_settings(id, war_base_rates) VALUES('clan', $1::jsonb) ON CONFLICT(id) DO UPDATE SET war_base_rates = EXCLUDED.war_base_rates",
    [JSON.stringify(TEST_RATES)],
  );
}
