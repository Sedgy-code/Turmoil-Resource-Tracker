import { randomUUID } from "node:crypto";
import type { Member } from "../types";
import { database, type Database } from "./db";
import { ApiError } from "./errors";
import { memberFromRow } from "./mappers";

const DAY = 86_400_000;
/** Members can mark themselves away for up to this long; leaders can set longer holidays. */
export const AWAY_MAX_DAYS = 90;

export interface MySettings {
  /** Away until this day (YYYY-MM-DD, inclusive), or null when back. */
  awayUntil?: string | null;
  /** A Discord message when they forget to save (a leader's nudge, at most once a week). */
  remindersAllowed?: boolean;
}

/**
 * The member's own settings from the Me page. Time away works like a holiday a leader sets: no
 * reminders, 🏖️ next to their name, and it goes in their history so leaders see it.
 */
export async function updateMySettings(actor: Member, input: MySettings, db?: Database, now = new Date()): Promise<Member> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    const rows = await tx.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actor.id]);
    if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
    if (input.awayUntil !== undefined) {
      const today = now.toISOString().slice(0, 10);
      const latest = new Date(now.getTime() + AWAY_MAX_DAYS * DAY).toISOString().slice(0, 10);
      const until = input.awayUntil;
      if (until !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < today || until > latest)) {
        throw new ApiError(400, "Pick a day between today and 90 days from now.", "INVALID_DATE");
      }
      const current = memberFromRow(rows[0]).holidayUntil ?? null;
      if (until !== current) {
        await tx.query("UPDATE app_members SET holiday_until = $2 WHERE id = $1", [actor.id, until]);
        await tx.query(
          "INSERT INTO member_events (id, member_id, kind, detail, created_at, created_by) VALUES ($1, $2, $3, $4, $5, $2)",
          [randomUUID(), actor.id, until ? "holiday" : "holiday-ended", until ?? "", now.toISOString()],
        );
      }
    }
    if (input.remindersAllowed !== undefined) {
      await tx.query("UPDATE app_members SET reminders_allowed = $2 WHERE id = $1", [actor.id, input.remindersAllowed]);
    }
    return memberFromRow((await tx.query("SELECT * FROM app_members WHERE id = $1", [actor.id]))[0]);
  });
}
