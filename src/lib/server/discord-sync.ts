import { randomUUID } from "node:crypto";
import { capturePendingSnapshots } from "./banks";
import { guildId } from "./config";
import { database, lockAdministration, type Database } from "./db";
import { ApiError } from "./errors";

/** Never remove more than this share of the roster in one go; something is probably wrong with Discord. */
const MAX_REMOVAL_SHARE = 0.3;

export interface DiscordSyncResult {
  configured: boolean;
  removed: string[];
  restored: string[];
  skipped?: string;
}

interface GuildMember { user?: { id?: string }; roles?: string[] }

/** Every server member (with the Turmoil role, when one is required), read with the site's bot. */
async function fetchGuildMemberIds(token: string, fetcher: typeof fetch): Promise<Set<string>> {
  const present = new Set<string>();
  let after = "0";
  for (let page = 0; page < 20; page++) {
    const response = await fetcher(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId())}/members?limit=1000&after=${after}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!response.ok) throw new ApiError(502, "Discord’s member list could not be read.", "DISCORD_SYNC_FAILED");
    const members = await response.json() as GuildMember[];
    if (!Array.isArray(members)) throw new ApiError(502, "Discord’s member list could not be read.", "DISCORD_SYNC_FAILED");
    const requiredRole = process.env.DISCORD_ROLE_ID;
    for (const member of members) {
      const id = member.user?.id;
      if (id && (!requiredRole || member.roles?.includes(requiredRole))) present.add(id);
    }
    if (members.length < 1000) return present;
    after = members[members.length - 1].user?.id ?? after;
  }
  return present;
}

/**
 * Deactivates tracker members who have left the Discord server (or lost the Turmoil role), and
 * reactivates anyone this check removed who has since come back. Members switched off by an admin
 * stay off.
 */
export async function syncDiscordMembers(dependencies: { db?: Database; fetcher?: typeof fetch } = {}): Promise<DiscordSyncResult> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { configured: false, removed: [], restored: [] };
  const present = await fetchGuildMemberIds(token, dependencies.fetcher ?? fetch);
  const db = dependencies.db ?? await database();
  return db.transaction(async (tx) => {
    await lockAdministration(tx, db.dialect);
    const members = await tx.query("SELECT id, discord_id, username, role, active, avatar_url FROM app_members");
    const autoRemoved = new Set((await tx.query("SELECT member_id FROM member_auto_removals")).map((row) => String(row.member_id)));
    const active = members.filter((row) => row.active === true);
    let leaving = active.filter((row) => !present.has(String(row.discord_id)));
    const returning = members.filter((row) => row.active !== true && autoRemoved.has(String(row.id)) && present.has(String(row.discord_id)));
    if (!present.size || leaving.length > Math.max(3, active.length * MAX_REMOVAL_SHARE)) {
      return { configured: true, removed: [], restored: [], skipped: "Too many members would be removed at once; nothing was changed." };
    }
    // Always keep at least one active admin.
    const adminsStaying = active.filter((row) => row.role === "ADMIN" && present.has(String(row.discord_id))).length;
    if (!adminsStaying) leaving = leaving.filter((row) => row.role !== "ADMIN");
    if (!leaving.length && !returning.length) return { configured: true, removed: [], restored: [] };
    // Close off completed weeks first so a roster change never rewrites an old week's totals.
    await capturePendingSnapshots(tx, new Date());
    for (const row of [...leaving.map((r) => ({ row: r, active: false })), ...returning.map((r) => ({ row: r, active: true }))]) {
      await tx.query("UPDATE app_members SET active = $2 WHERE id = $1", [row.row.id, row.active]);
      await tx.query(`INSERT INTO member_status_events (id,member_id,active,role,username,avatar_url,changed_at)
        VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp())`, [randomUUID(), row.row.id, row.active, row.row.role, row.row.username, row.row.avatar_url]);
      if (row.active) await tx.query("DELETE FROM member_auto_removals WHERE member_id = $1", [row.row.id]);
      else {
        await tx.query("DELETE FROM auth_sessions WHERE member_id = $1", [row.row.id]);
        await tx.query("INSERT INTO member_auto_removals (member_id, removed_at) VALUES ($1, NOW()) ON CONFLICT (member_id) DO UPDATE SET removed_at = NOW()", [row.row.id]);
      }
    }
    return { configured: true, removed: leaving.map((row) => String(row.username)), restored: returning.map((row) => String(row.username)) };
  });
}
