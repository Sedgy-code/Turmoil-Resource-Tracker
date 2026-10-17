import { randomUUID } from "node:crypto";
import { capturePendingSnapshots } from "./banks";
import { guildId } from "./config";
import { database, lockAdministration, type Database } from "./db";
import { ApiError } from "./errors";
import { recordMemberProfile } from "./auth";
import { memberFromRow } from "./mappers";

/** Never remove more than this share of the roster in one go; something is probably wrong with Discord. */
const MAX_REMOVAL_SHARE = 0.3;

export interface DiscordSyncResult {
  configured: boolean;
  removed: string[];
  restored: string[];
  /** Clan members on Discord who were added to the site without having signed in. */
  added: string[];
  skipped?: string;
}

interface GuildMember {
  user?: { id?: string; username?: string; global_name?: string | null; avatar?: string | null; bot?: boolean };
  nick?: string | null;
  roles?: string[];
}

/** The clan's Discord role ("Turmoil" unless DISCORD_CLAN_ROLE_NAME says otherwise). */
export async function clanRoleId(token: string, fetcher: typeof fetch): Promise<string | null> {
  if (process.env.DISCORD_ROLE_ID) return process.env.DISCORD_ROLE_ID;
  const response = await fetcher(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId())}/roles`, { headers: { Authorization: `Bot ${token}` } });
  if (!response.ok) return null;
  const roles = await response.json() as { id: string; name: string }[];
  const wanted = (process.env.DISCORD_CLAN_ROLE_NAME || "Turmoil").toLowerCase();
  return Array.isArray(roles) ? roles.find((role) => String(role?.name ?? "").toLowerCase() === wanted)?.id ?? null : null;
}

/** Every server member, read with the site's bot. */
async function fetchGuildMembers(token: string, fetcher: typeof fetch): Promise<GuildMember[]> {
  const all: GuildMember[] = [];
  let after = "0";
  for (let page = 0; page < 20; page++) {
    const response = await fetcher(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId())}/members?limit=1000&after=${after}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!response.ok) throw new ApiError(502, "Discord’s member list could not be read.", "DISCORD_SYNC_FAILED");
    const members = await response.json() as GuildMember[];
    if (!Array.isArray(members)) throw new ApiError(502, "Discord’s member list could not be read.", "DISCORD_SYNC_FAILED");
    all.push(...members);
    if (members.length < 1000) return all;
    after = members[members.length - 1].user?.id ?? after;
  }
  return all;
}

function avatarUrl(member: GuildMember): string | null {
  return member.user?.id && member.user.avatar ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=128` : null;
}

/**
 * Deactivates tracker members who have left the Discord server (or lost the Turmoil role), and
 * reactivates anyone this check removed who has since come back. Members switched off by an admin
 * stay off.
 */
export async function syncDiscordMembers(dependencies: { db?: Database; fetcher?: typeof fetch } = {}): Promise<DiscordSyncResult> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { configured: false, removed: [], restored: [], added: [] };
  const fetcher = dependencies.fetcher ?? fetch;
  const guildMembers = (await fetchGuildMembers(token, fetcher)).filter((member) => member.user?.id && !member.user.bot);
  const requiredRole = process.env.DISCORD_ROLE_ID;
  const present = new Set(guildMembers.filter((member) => !requiredRole || member.roles?.includes(requiredRole)).map((member) => member.user!.id!));
  const roleId = await clanRoleId(token, fetcher);
  const clanMembers = roleId ? guildMembers.filter((member) => member.roles?.includes(roleId)) : [];
  const db = dependencies.db ?? await database();
  return db.transaction(async (tx) => {
    await lockAdministration(tx, db.dialect);
    const members = await tx.query("SELECT id, discord_id, username, role, active, avatar_url FROM app_members");
    const autoRemoved = new Set((await tx.query("SELECT member_id FROM member_auto_removals")).map((row) => String(row.member_id)));
    const active = members.filter((row) => row.active === true);
    let leaving = active.filter((row) => !present.has(String(row.discord_id)));
    const returning = members.filter((row) => row.active !== true && autoRemoved.has(String(row.id)) && present.has(String(row.discord_id)));
    if (!present.size || leaving.length > Math.max(3, active.length * MAX_REMOVAL_SHARE)) {
      return { configured: true, removed: [], restored: [], added: [], skipped: "Too many members would be removed at once; nothing was changed." };
    }
    // Always keep at least one active admin.
    const adminsStaying = active.filter((row) => row.role === "ADMIN" && present.has(String(row.discord_id))).length;
    if (!adminsStaying) leaving = leaving.filter((row) => row.role !== "ADMIN");
    // Clan members (Turmoil role) who have never signed in still count: add them so rankings include them.
    const known = new Set(members.map((row) => String(row.discord_id)));
    const newcomers = clanMembers.filter((member) => !known.has(member.user!.id!));
    // Close off completed weeks first so a roster change never rewrites an old week's totals.
    if (newcomers.length || leaving.length || returning.length) await capturePendingSnapshots(tx, new Date());
    const added: string[] = [];
    for (const member of newcomers) {
      const user = member.user!;
      const name = (member.nick || user.global_name || user.username || "Clan member").slice(0, 80);
      const rows = await tx.query(`INSERT INTO app_members (id, discord_id, username, display_name, avatar_url, role, never_signed_in)
        VALUES ($1, $2, $3, $4, $5, 'MEMBER', TRUE) ON CONFLICT (discord_id) DO NOTHING RETURNING *`,
      [randomUUID(), user.id, user.username || name, name, avatarUrl(member)]);
      if (rows.length) {
        await recordMemberProfile(tx, memberFromRow(rows[0]));
        added.push(name);
      }
    }
    if (!leaving.length && !returning.length) return { configured: true, removed: [], restored: [], added };
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
    return { configured: true, removed: leaving.map((row) => String(row.username)), restored: returning.map((row) => String(row.username)), added };
  });
}
