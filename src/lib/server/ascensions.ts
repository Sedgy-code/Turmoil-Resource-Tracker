import { ASCENSION_PILLARS } from "../ascension";
import { currentWeek } from "../resources";
import type { AscensionPillar, AscensionsResponse, Member } from "../types";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";

export function parsePillars(text: string): AscensionPillar[] {
  const chosen = new Set(text.split(","));
  return ASCENSION_PILLARS.filter((pillar) => chosen.has(pillar));
}

async function requireActive(connection: SqlConnection, actorId: string): Promise<void> {
  const rows = await connection.query("SELECT 1 FROM app_members WHERE id = $1 AND active = TRUE", [actorId]);
  if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
}

/**
 * Who is ascending in one clan week (Monday to Monday, UTC), and your own answer. Everyone can see
 * this, so leadership can plan the war around members who are ascending.
 */
export async function getAscensions(actor: Member, week = currentWeek(), db?: Database): Promise<AscensionsResponse> {
  const connection = db ?? await database();
  await requireActive(connection, actor.id);
  const rows = await connection.query(
    `SELECT a.member_id, a.pillars FROM member_ascensions a JOIN app_members m ON m.id = a.member_id
     WHERE a.week_start = $1 AND m.active = TRUE`,
    [week],
  );
  const answers = rows.map((row) => ({ memberId: String(row.member_id), pillars: parsePillars(String(row.pillars)) }));
  return {
    week,
    mine: answers.find((answer) => answer.memberId === actor.id)?.pillars ?? null,
    ascending: answers.filter((answer) => answer.pillars.length > 0),
  };
}

/** Saves your answer for this clan week; an empty list means you're not ascending. */
export async function setAscension(actor: Member, pillars: AscensionPillar[], db?: Database, now = new Date()): Promise<AscensionsResponse> {
  const connection = db ?? await database();
  await requireActive(connection, actor.id);
  const week = currentWeek(now);
  await connection.query(
    `INSERT INTO member_ascensions (member_id, week_start, pillars, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (member_id, week_start) DO UPDATE SET pillars = EXCLUDED.pillars, updated_at = NOW()`,
    [actor.id, week, ASCENSION_PILLARS.filter((pillar) => pillars.includes(pillar)).join(",")],
  );
  return getAscensions(actor, week, connection);
}
