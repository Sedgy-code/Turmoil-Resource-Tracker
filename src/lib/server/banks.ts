import { randomUUID } from "node:crypto";
import {
  currentWeek,
  EMPTY_PLANNING_DETAILS,
  EMPTY_RESOURCES,
  EMPTY_SUMMONING_COSTS,
  normalizeResources,
  shiftWeek,
  type PlanningDetails,
  type ResourceValues,
  type SummoningCosts,
} from "../resources";
import type {
  BankHistoryResponse,
  BankHistorySnapshot,
  DashboardResponse,
  Member,
  ResourceEntry,
} from "../types";
import { database, lockAdministration, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { entryFromRow, iso, memberFromRow } from "./mappers";
import { awardDewForBankUpdate } from "./planning";

async function activeActor(tx: SqlConnection, actorId: string): Promise<Member> {
  const rows = await tx.query("SELECT * FROM app_members WHERE id = $1 AND active = TRUE", [actorId]);
  if (!rows.length) throw new ApiError(403, "Your tracker account is inactive.", "ACCOUNT_INACTIVE");
  return memberFromRow(rows[0]);
}

function aggregate(entries: ResourceEntry[]) {
  const totals = { ...EMPTY_RESOURCES };
  const summons = { skills: 0, mounts: 0, missingSkillCosts: 0, missingMountCosts: 0 };
  for (const entry of entries) {
    for (const key of Object.keys(totals) as (keyof ResourceValues)[]) totals[key] += entry.resources[key];
    if (entry.summoningCosts.fiveSkills > 0) summons.skills += wholeSummons(entry.resources.skillTickets * 5, entry.summoningCosts.fiveSkills);
    else if (entry.resources.skillTickets > 0) summons.missingSkillCosts++;
    if (entry.summoningCosts.mount > 0) summons.mounts += wholeSummons(entry.resources.mountKeys, entry.summoningCosts.mount);
    else if (entry.resources.mountKeys > 0) summons.missingMountCosts++;
  }
  return { totals, summons };
}

function wholeSummons(quantity: number, unitCost: number): number {
  // Calculate each member separately: spare resources cannot be pooled. Saved
  // decimal costs use integer division to preserve exact affordable actions.
  const scaled = unitCost * 10;
  const rounded = Math.round(scaled);
  return rounded > 0 && Math.abs(scaled - rounded) < 1e-7
    ? Math.floor(quantity * 10 / rounded)
    : Math.floor(quantity / unitCost);
}

function bankEntry(row: Record<string, unknown>, week: string, editorName?: string): ResourceEntry {
  return entryFromRow({
    ...row,
    id: row.id ?? `bank:${row.member_id}`,
    week_start: week,
    updated_by_username: editorName ?? row.updated_by_username,
  });
}

function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function snapshotFromRow(row: Record<string, unknown>): BankHistorySnapshot {
  return {
    ...(row.id ? { id: String(row.id) } : {}),
    week: row.week_start instanceof Date ? row.week_start.toISOString().slice(0, 10) : String(row.week_start).slice(0, 10),
    capturedAt: iso(row.captured_at)!,
    automatic: row.automatic === true,
    members: json<Member[]>(row.members),
    entries: json<ResourceEntry[]>(row.entries),
    totals: normalizeResources(json(row.totals)),
  };
}

async function insertSnapshot(tx: SqlConnection, snapshot: BankHistorySnapshot): Promise<void> {
  await tx.query(
    `INSERT INTO bank_snapshots (week_start,captured_at,automatic,members,entries,totals)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)
     ON CONFLICT (week_start) DO NOTHING`,
    [snapshot.week, snapshot.capturedAt, snapshot.automatic,
      JSON.stringify(snapshot.members), JSON.stringify(snapshot.entries), JSON.stringify(snapshot.totals)],
  );
}

/** Called while holding the administration lock, including before bank/roster writes. */
export async function capturePendingSnapshots(tx: SqlConnection, now = new Date()): Promise<number> {
  if (!Number.isFinite(now.getTime()) || now.getUTCFullYear() < 2000 || now.getUTCFullYear() > 2100) {
    throw new ApiError(400, "Choose a supported snapshot date.", "INVALID_SNAPSHOT_DATE");
  }
  // Demo seeding and old clients can create weekly rows after initialization.
  // Import only members without a bank; existing live data always wins.
  await tx.query(
    `INSERT INTO member_banks (member_id,resources,summoning_costs,planning_details,notes,updated_at,updated_by)
     SELECT DISTINCT ON (member_id) member_id,resources,summoning_costs,planning_details,notes,updated_at,updated_by
     FROM resource_entries ORDER BY member_id,week_start DESC,updated_at DESC
     ON CONFLICT (member_id) DO NOTHING`,
  );
  await tx.query(
    `INSERT INTO bank_versions (id,member_id,resources,summoning_costs,planning_details,notes,updated_at,updated_by)
     SELECT 'initial:' || b.member_id,b.member_id,b.resources,b.summoning_costs,b.planning_details,b.notes,b.updated_at,b.updated_by
     FROM member_banks b WHERE NOT EXISTS (SELECT 1 FROM bank_versions v WHERE v.member_id=b.member_id)
     ON CONFLICT (id) DO NOTHING`,
  );
  // Members created after schema migration still need an initial roster event.
  // It describes the known initial state; later changes append their own events.
  await tx.query(
    `INSERT INTO member_status_events (id,member_id,active,role,username,avatar_url,changed_at)
     SELECT 'baseline:' || m.id,m.id,m.active,m.role,COALESCE(NULLIF(m.display_name,''),m.username),m.avatar_url,m.joined_at
     FROM app_members m WHERE NOT EXISTS (SELECT 1 FROM member_status_events s WHERE s.member_id=m.id)
     ON CONFLICT (id) DO NOTHING`,
  );
  // A transaction owns one PostgreSQL client; its queries must run in order.
  const members = await tx.query("SELECT * FROM app_members ORDER BY id");
  const versions = await tx.query("SELECT * FROM bank_versions WHERE updated_at <= $1 ORDER BY updated_at,id", [now.toISOString()]);
  const events = await tx.query("SELECT * FROM member_status_events WHERE changed_at <= $1 ORDER BY changed_at,id", [now.toISOString()]);
  const existingRows = await tx.query("SELECT week_start::text AS week FROM bank_snapshots");
  const historyStateRows = await tx.query("SELECT started_at FROM bank_history_state WHERE id='live-banks'");
  const legacyRows = await tx.query(
      `SELECT e.*,COALESCE(NULLIF(editor.display_name,''),editor.username) AS updated_by_username
       FROM resource_entries e JOIN app_members editor ON editor.id=e.updated_by
       WHERE e.week_start < $1 ORDER BY e.week_start,e.updated_at DESC`,
      [currentWeek(now)],
    );
  const existing = new Set(existingRows.map((row) => String(row.week)));
  const memberMap = new Map(members.map((row) => [String(row.id), memberFromRow(row)]));
  const capturedAt = now.toISOString();
  let captured = 0;

  // Keep the old explicitly submitted weekly records. They predate the version
  // ledger and cannot honestly be reconstructed as a live bank at past cutoffs.
  const legacyWeeks = new Map<string, ResourceEntry[]>();
  for (const row of legacyRows) {
    const entry = entryFromRow(row);
    const entries = legacyWeeks.get(entry.week) ?? [];
    entries.push(entry);
    legacyWeeks.set(entry.week, entries);
  }
  // Initial versions are each member's latest migrated bank, not a complete
  // historical ledger. An older initial row from one member must never replace
  // another member's original weekly submission with a partial reconstruction.
  const firstLiveVersion = versions.find((row) => !String(row.id).startsWith("initial:"));
  const firstLiveWeek = firstLiveVersion ? currentWeek(new Date(iso(firstLiveVersion.updated_at)!)) : null;
  const markerWeek = currentWeek(new Date(iso(historyStateRows[0]?.started_at) ?? now.toISOString()));
  // The persisted activation week starts automatic capture even if nobody ever
  // edits an imported bank. Earlier real versions remain replayable in fixtures
  // and installations that already had a live bank ledger before this marker.
  const modernStartWeek = firstLiveWeek && firstLiveWeek < markerWeek ? firstLiveWeek : markerWeek;
  for (const [week, entries] of legacyWeeks) {
    const cutoff = `${shiftWeek(week, 1)}T00:00:00.000Z`;
    if (existing.has(week) || week >= modernStartWeek) continue;
    const owners = new Set(entries.map((entry) => entry.memberId));
    const frozenMembers = [...memberMap.values()]
      .filter((member) => owners.has(member.id) || (member.active && member.joinedAt < cutoff));
    await insertSnapshot(tx, { week, capturedAt, automatic: false, members: frozenMembers, entries, totals: aggregate(entries).totals });
    existing.add(week);
    captured++;
  }
  const endingWeek = shiftWeek(currentWeek(now), -1);
  let week = modernStartWeek;
  if (week < "2000-01-03") week = "2000-01-03";
  const maxEarliest = shiftWeek(endingWeek, -5199);
  if (week < maxEarliest) week = maxEarliest;
  let versionIndex = 0;
  let eventIndex = 0;
  const versionState = new Map<string, Record<string, unknown>>();
  const statusState = new Map<string, Record<string, unknown>>();
  while (week <= endingWeek) {
    const cutoff = `${shiftWeek(week, 1)}T00:00:00.000Z`;
    while (versionIndex < versions.length && iso(versions[versionIndex].updated_at)! < cutoff) {
      const row = versions[versionIndex++];
      versionState.set(String(row.member_id), row);
    }
    while (eventIndex < events.length && iso(events[eventIndex].changed_at)! < cutoff) {
      const row = events[eventIndex++];
      statusState.set(String(row.member_id), row);
    }
    if (!existing.has(week)) {
      const frozenMembers: Member[] = [];
      for (const member of memberMap.values()) {
        const status = statusState.get(member.id);
        if (!status || status.active !== true || member.joinedAt > cutoff) continue;
        const version = versionState.get(member.id);
        frozenMembers.push({
          ...member,
          username: String(status.username),
          avatarUrl: status.avatar_url ? String(status.avatar_url) : null,
          role: status.role as Member["role"],
          active: true,
          lastUpdatedAt: version ? iso(version.updated_at) : null,
        });
      }
      frozenMembers.sort((a, b) => a.username.localeCompare(b.username));
      const entries = frozenMembers.flatMap((member) => {
        const version = versionState.get(member.id);
        if (!version) return [];
        const editorStatus = statusState.get(String(version.updated_by));
        const editorName = editorStatus?.username ?? memberMap.get(String(version.updated_by))?.username;
        return [bankEntry(version, week, editorName ? String(editorName) : "Clan member")];
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      await insertSnapshot(tx, { week, capturedAt, automatic: true, members: frozenMembers, entries, totals: aggregate(entries).totals });
      captured++;
    }
    week = shiftWeek(week, 1);
  }
  return captured;
}

export async function captureWeeklySnapshots(db?: Database, now = new Date()): Promise<number> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    return capturePendingSnapshots(tx, now);
  });
}

async function dashboardInTransaction(tx: SqlConnection, actor: Member, week: string): Promise<DashboardResponse> {
  const memberRows = await tx.query("SELECT * FROM app_members WHERE active=TRUE ORDER BY LOWER(COALESCE(NULLIF(display_name,''),username))");
  const entryRows = await tx.query(
      `SELECT b.*,COALESCE(NULLIF(editor.display_name,''),editor.username) AS updated_by_username
       FROM member_banks b JOIN app_members owner ON owner.id=b.member_id
       JOIN app_members editor ON editor.id=b.updated_by
       WHERE owner.active=TRUE ORDER BY b.updated_at DESC`,
    );
  const weekRows = await tx.query("SELECT week_start::text AS week FROM bank_snapshots ORDER BY week_start DESC");
  const members = memberRows.map(memberFromRow);
  const entries = entryRows.map((row) => bankEntry(row, week));
  return {
    week,
    currentUser: actor,
    members,
    entries,
    ...aggregate(entries),
    stats: { totalMembers: members.length, submittedMembers: entries.length,
      pendingMembers: Math.max(0, members.length - entries.length), lastUpdatedAt: entries[0]?.updatedAt ?? null },
    weeks: [...new Set([week, ...weekRows.map((row) => String(row.week))])].sort().reverse(),
    live: true,
    snapshot: null,
  };
}

export async function liveDashboard(actor: Member, db?: Database): Promise<DashboardResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    const now = new Date();
    await capturePendingSnapshots(tx, now);
    return dashboardInTransaction(tx, freshActor, currentWeek(now));
  });
}

export async function saveBank(
  actor: Member,
  input: { memberId?: string; resources: ResourceValues; summoningCosts?: SummoningCosts; planningDetails?: PlanningDetails; notes: string },
  db?: Database,
): Promise<ResourceEntry> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    const memberId = input.memberId ?? actor.id;
    if (memberId !== freshActor.id && freshActor.role !== "ADMIN") {
      throw new ApiError(403, "You can only edit your own resources.", "FORBIDDEN");
    }
    const targetRows = await tx.query("SELECT id FROM app_members WHERE id=$1 AND active=TRUE", [memberId]);
    if (!targetRows.length) throw new ApiError(404, "This member is inactive or could not be found.", "MEMBER_NOT_FOUND");
    const now = new Date();
    await capturePendingSnapshots(tx, now);
    const oldRows = await tx.query("SELECT * FROM member_banks WHERE member_id=$1", [memberId]);
    const old = oldRows[0] ? bankEntry(oldRows[0], currentWeek(now)) : null;
    const resources = normalizeResources(input.resources);
    const costs = input.summoningCosts ?? old?.summoningCosts ?? EMPTY_SUMMONING_COSTS;
    const details = input.planningDetails ?? old?.planningDetails ?? EMPTY_PLANNING_DETAILS;
    const rows = await tx.query(
      `INSERT INTO member_banks (member_id,resources,summoning_costs,planning_details,notes,updated_by,updated_at)
       VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,clock_timestamp())
       ON CONFLICT (member_id) DO UPDATE SET resources=EXCLUDED.resources,
       summoning_costs=EXCLUDED.summoning_costs,planning_details=EXCLUDED.planning_details,
       notes=EXCLUDED.notes,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [memberId, JSON.stringify(resources), JSON.stringify(costs), JSON.stringify(details), input.notes, freshActor.id],
    );
    const row = rows[0];
    const savedWeek = currentWeek(new Date(iso(row.updated_at)!));
    const versionId = randomUUID();
    await tx.query(
      `INSERT INTO bank_versions (id,member_id,resources,summoning_costs,planning_details,notes,updated_by,updated_at)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6,$7,$8)`,
      [versionId, memberId, JSON.stringify(resources), JSON.stringify(costs), JSON.stringify(details), input.notes, freshActor.id, row.updated_at],
    );
    await tx.query("UPDATE app_members SET last_updated_at=$2 WHERE id=$1", [memberId, row.updated_at]);
    const resourceChanged = Object.keys(resources).some((key) =>
      resources[key as keyof ResourceValues] !== (old?.resources ?? EMPTY_RESOURCES)[key as keyof ResourceValues]);
    if (memberId === freshActor.id && resourceChanged) await awardDewForBankUpdate(tx, memberId);
    // Keep old API clients and exports useful without making legacy week edits
    // mutate the persistent bank or its freshness indicator.
    await tx.query(
      `INSERT INTO resource_entries (id,member_id,week_start,resources,summoning_costs,planning_details,notes,updated_by,updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9)
       ON CONFLICT (member_id,week_start) DO UPDATE SET resources=EXCLUDED.resources,
       summoning_costs=EXCLUDED.summoning_costs,planning_details=EXCLUDED.planning_details,
       notes=EXCLUDED.notes,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,
      [randomUUID(), memberId, savedWeek, JSON.stringify(resources), JSON.stringify(costs), JSON.stringify(details), input.notes, freshActor.id, row.updated_at],
    );
    return bankEntry(row, savedWeek, freshActor.username);
  });
}

export async function bankHistory(actor: Member, db?: Database): Promise<BankHistoryResponse> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    const now = new Date();
    await capturePendingSnapshots(tx, now);
    const snapshots = (await tx.query(
      `SELECT NULL::text AS id,week_start,captured_at,automatic,members,entries,totals FROM bank_snapshots
       UNION ALL
       SELECT id,week_start,captured_at,FALSE AS automatic,members,entries,totals FROM bank_manual_snapshots
       ORDER BY week_start DESC,captured_at DESC`,
    )).map(snapshotFromRow);
    const current = await dashboardInTransaction(tx, freshActor, currentWeek(now));
    return { snapshots, current };
  });
}

export async function historicalBankDashboard(actor: Member, week: string, db?: Database, snapshotId?: string): Promise<DashboardResponse> {
  const history = await bankHistory(actor, db);
  const matching = history.snapshots.filter((item) => item.week === week);
  // A completed week's cutoff always takes precedence over an earlier manual
  // capture from that week. Manual captures remain individually visible in history.
  const snapshot = snapshotId
    ? matching.find((item) => item.id === snapshotId)
    : matching.find((item) => !("id" in item)) ?? matching[0];
  if (!snapshot) throw new ApiError(404, "No bank snapshot was saved for this week.", "SNAPSHOT_NOT_FOUND");
  return {
    week,
    currentUser: history.current.currentUser,
    members: snapshot.members,
    entries: snapshot.entries,
    totals: snapshot.totals,
    summons: aggregate(snapshot.entries).summons,
    stats: { totalMembers: snapshot.members.length, submittedMembers: snapshot.entries.length,
      pendingMembers: Math.max(0, snapshot.members.length - snapshot.entries.length),
      lastUpdatedAt: [...snapshot.entries].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.updatedAt ?? null },
    weeks: history.current.weeks,
    live: false,
    snapshot: { capturedAt: snapshot.capturedAt, automatic: snapshot.automatic },
  };
}

export async function captureSnapshot(actor: Member, db?: Database): Promise<BankHistorySnapshot> {
  const connection = db ?? await database();
  return connection.transaction(async (tx) => {
    await lockAdministration(tx, connection.dialect);
    const freshActor = await activeActor(tx, actor.id);
    if (freshActor.role !== "ADMIN") throw new ApiError(403, "Only administrators can save a snapshot.", "ADMIN_REQUIRED");
    const now = new Date();
    await capturePendingSnapshots(tx, now);
    const week = currentWeek(now);
    const live = await dashboardInTransaction(tx, freshActor, week);
    const rows = await tx.query(
      `INSERT INTO bank_manual_snapshots (id,week_start,captured_at,members,entries,totals)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb) RETURNING *,FALSE AS automatic`,
      [randomUUID(), week, now.toISOString(), JSON.stringify(live.members), JSON.stringify(live.entries), JSON.stringify(live.totals)],
    );
    return snapshotFromRow(rows[0]);
  });
}
