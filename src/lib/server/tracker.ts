import { randomUUID } from "node:crypto";
import { EMPTY_RESOURCES, shiftWeek, type ResourceValues, type SummoningCosts } from "../resources";
import type { DashboardResponse, Member, ResourceEntry } from "../types";
import {
  database,
  lockAdministration,
  type Database,
  type SqlConnection,
} from "./db";
import { ApiError } from "./errors";
import { entryFromRow, memberFromRow } from "./mappers";

async function activeActor(
  tx: SqlConnection,
  actorId: string,
): Promise<Member> {
  const rows = await tx.query(
    "SELECT * FROM app_members WHERE id = $1 AND active = TRUE",
    [actorId],
  );
  if (!rows.length)
    throw new ApiError(
      403,
      "Your tracker account is inactive.",
      "ACCOUNT_INACTIVE",
    );
  return memberFromRow(rows[0]);
}
async function authorizedTarget(
  tx: SqlConnection,
  actor: Member,
  memberId: string,
): Promise<void> {
  if (actor.id !== memberId && actor.role !== "ADMIN")
    throw new ApiError(
      403,
      "You can only edit your own resources.",
      "FORBIDDEN",
    );
  const rows = await tx.query(
    "SELECT id FROM app_members WHERE id = $1 AND active = TRUE",
    [memberId],
  );
  if (!rows.length)
    throw new ApiError(
      404,
      "This member is inactive or could not be found.",
      "MEMBER_NOT_FOUND",
    );
}

async function writeEntry(
  tx: SqlConnection,
  actor: Member,
  memberId: string,
  week: string,
  resources: ResourceValues,
  notes: string,
  summoningCosts?: SummoningCosts,
): Promise<ResourceEntry> {
  const rows = await tx.query(
    `INSERT INTO resource_entries (id,member_id,week_start,resources,notes,updated_by,summoning_costs)
    VALUES ($1,$2,$3,$4::jsonb,$5,$6,COALESCE($7::jsonb, '{}'::jsonb))
    ON CONFLICT (member_id,week_start) DO UPDATE SET resources = EXCLUDED.resources, notes = EXCLUDED.notes, summoning_costs = COALESCE($7::jsonb, resource_entries.summoning_costs), updated_at = NOW(), updated_by = EXCLUDED.updated_by
    RETURNING *`,
    [randomUUID(), memberId, week, JSON.stringify(resources), notes, actor.id, summoningCosts === undefined ? null : JSON.stringify(summoningCosts)],
  );
  await tx.query(
    "UPDATE app_members SET last_updated_at = NOW() WHERE id = $1",
    [memberId],
  );
  return entryFromRow({ ...rows[0], updated_by_username: actor.username });
}

export async function saveEntry(
  actor: Member,
  input: {
    week: string;
    memberId?: string;
    resources: ResourceValues;
    summoningCosts?: SummoningCosts;
    notes: string;
  },
  db?: Database,
): Promise<ResourceEntry> {
  const connection = db ?? (await database());
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    const memberId = input.memberId ?? actor.id;
    await authorizedTarget(tx, freshActor, memberId);
    return writeEntry(
      tx,
      freshActor,
      memberId,
      input.week,
      input.resources,
      input.notes,
      input.summoningCosts,
    );
  });
}

export async function copyPreviousEntry(
  actor: Member,
  input: { week: string; memberId?: string },
  db?: Database,
): Promise<ResourceEntry> {
  const connection = db ?? (await database());
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    const memberId = input.memberId ?? actor.id;
    await authorizedTarget(tx, freshActor, memberId);
    const previous = await tx.query(
      "SELECT e.*, COALESCE(NULLIF(m.display_name, ''), m.username) AS updated_by_username FROM resource_entries e JOIN app_members m ON m.id = e.updated_by WHERE e.member_id = $1 AND e.week_start = $2",
      [memberId, shiftWeek(input.week, -1)],
    );
    if (!previous.length)
      throw new ApiError(
        404,
        "No resources were saved for the previous week.",
        "PREVIOUS_WEEK_EMPTY",
      );
    const entry = entryFromRow(previous[0]);
    return writeEntry(
      tx,
      freshActor,
      memberId,
      input.week,
      entry.resources,
      entry.notes,
      entry.summoningCosts,
    );
  });
}

export async function updateMember(
  actor: Member,
  memberId: string,
  changes: { role?: "ADMIN" | "MEMBER"; active?: boolean },
  db?: Database,
): Promise<Member> {
  const connection = db ?? (await database());
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    if (freshActor.role !== "ADMIN")
      throw new ApiError(
        403,
        "Only administrators can manage members.",
        "ADMIN_REQUIRED",
      );
    const rows = await tx.query("SELECT * FROM app_members WHERE id = $1", [
      memberId,
    ]);
    if (!rows.length)
      throw new ApiError(
        404,
        "This member could not be found.",
        "MEMBER_NOT_FOUND",
      );
    const member = memberFromRow(rows[0]);
    const role = changes.role ?? member.role;
    const active = changes.active ?? member.active;
    if (
      member.role === "ADMIN" &&
      member.active &&
      (role !== "ADMIN" || !active)
    ) {
      const admins = await tx.query(
        "SELECT id FROM app_members WHERE role = 'ADMIN' AND active = TRUE",
      );
      if (admins.length <= 1)
        throw new ApiError(
          409,
          "Promote another active administrator before changing the last administrator.",
          "LAST_ADMIN",
        );
    }
    const updated = await tx.query(
      "UPDATE app_members SET role = $2, active = $3 WHERE id = $1 RETURNING *",
      [memberId, role, active],
    );
    if (!active)
      await tx.query("DELETE FROM auth_sessions WHERE member_id = $1", [
        memberId,
      ]);
    return memberFromRow(updated[0]);
  });
}

export async function listWeeks(db?: Database): Promise<string[]> {
  const connection = db ?? (await database());
  const rows = await connection.query(
    "SELECT DISTINCT week_start::text AS week FROM resource_entries ORDER BY week DESC",
  );
  return rows.map((row) => String(row.week));
}

export async function dashboard(
  actor: Member,
  week: string,
  db?: Database,
): Promise<DashboardResponse> {
  const connection = db ?? (await database());
  const [memberRows, entryRows, weeks] = await Promise.all([
    connection.query(
      "SELECT * FROM app_members WHERE active = TRUE ORDER BY LOWER(COALESCE(NULLIF(display_name, ''), username))",
    ),
    connection.query(
      `SELECT e.*, COALESCE(NULLIF(editor.display_name, ''), editor.username) AS updated_by_username FROM resource_entries e
      JOIN app_members owner ON owner.id = e.member_id
      JOIN app_members editor ON editor.id = e.updated_by
      WHERE e.week_start = $1 AND owner.active = TRUE ORDER BY e.updated_at DESC`,
      [week],
    ),
    listWeeks(connection),
  ]);
  const members = memberRows.map(memberFromRow);
  const entries = entryRows.map(entryFromRow);
  const totals = { ...EMPTY_RESOURCES };
  const summons = { skills: 0, mounts: 0, missingSkillCosts: 0, missingMountCosts: 0 };
  for (const entry of entries) {
    for (const key of Object.keys(totals) as (keyof ResourceValues)[])
      totals[key] += entry.resources[key];
    if (entry.summoningCosts.fiveSkills > 0) {
      summons.skills += (entry.resources.skillTickets * 5) / entry.summoningCosts.fiveSkills;
    } else if (entry.resources.skillTickets > 0) {
      summons.missingSkillCosts++;
    }
    if (entry.summoningCosts.mount > 0) {
      summons.mounts += entry.resources.mountKeys / entry.summoningCosts.mount;
    } else if (entry.resources.mountKeys > 0) {
      summons.missingMountCosts++;
    }
  }
  summons.skills = Math.round(summons.skills);
  summons.mounts = Math.round(summons.mounts);
  return {
    week,
    currentUser: actor,
    members,
    entries,
    totals,
    summons,
    stats: {
      totalMembers: members.length,
      submittedMembers: entries.length,
      pendingMembers: Math.max(0, members.length - entries.length),
      lastUpdatedAt: entries[0]?.updatedAt ?? null,
    },
    weeks,
  };
}

export async function listMembers(
  actor: Member,
  db?: Database,
): Promise<Member[]> {
  const connection = db ?? (await database());
  const freshActor = await activeActor(connection, actor.id);
  if (freshActor.role !== "ADMIN")
    throw new ApiError(
      403,
      "Only administrators can manage members.",
      "ADMIN_REQUIRED",
    );
  return (
    await connection.query(
      "SELECT * FROM app_members ORDER BY active DESC, role, LOWER(COALESCE(NULLIF(display_name, ''), username))",
    )
  ).map(memberFromRow);
}
