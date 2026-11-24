import {
  mountName, petName, pieceKey, skillName, statName, BUILDS_PAGE_URL,
  type Build, type BuildChanges, type BuildGoal, type BuildPiece, type BuildSnapshot, type BuildsDiscordState, type BuildsEmbed, type BuildsResponse,
} from "../builds";
import type { Member } from "../types";
import { appUrl } from "./config";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { iso } from "./mappers";
import { buildChanges, loadBuilds, requireBuildsLeader, syncBuilds } from "./builds";
import { botToken, discordReason, DISCORD_API } from "./spending-order";

/**
 * The builds thread in #🛡️-build-guide: a short message in the channel says what it is, and its
 * thread gets a message with the builds after each game update. The newest builds are the last
 * message, so members see them first. Older messages stay above, greyed out and marked as old
 * builds: the archive. Discord posts are in English, with no pings.
 */
export const BUILDS_CHANNEL_ID = "1560553340931276950";
export const BUILDS_THREAD_NAME = "📈 Meta builds";
const LANGUAGE = "en";
const SUMMARY_COLOR = 0xe6bd59;
const OLD_COLOR = 0x4f545c;
const GOAL_STYLE: Record<BuildGoal, { emoji: string; label: string; color: number }> = {
  arena: { emoji: "⚔️", label: "Arena & PvP", color: 0xe74c3c },
  quest: { emoji: "🗺️", label: "Main Quest", color: 0x3498db },
  dpsMelee: { emoji: "🗡️", label: "Melee damage", color: 0xe67e22 },
  dpsRanged: { emoji: "🏹", label: "Ranged damage", color: 0x9b59b6 },
  healing: { emoji: "💚", label: "Healing", color: 0x2ecc71 },
};

function channelId(): string {
  return process.env.DISCORD_BUILDS_CHANNEL_ID || BUILDS_CHANNEL_ID;
}

const day = (value: string | null) => (value
  ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  : "");
const percent = (rate: number) => `${Math.round(rate * 100)}%`;
const joined = (names: string[]) => names.filter(Boolean).join(" · ");

/** "Cosmic Jellyfish (Critical Damage + Lifesteal) ×2": identical pets counted once. */
function petsLine(snapshot: BuildSnapshot, pets: BuildPiece[]): string {
  const groups = new Map<string, { pet: BuildPiece; count: number }>();
  for (const pet of pets) {
    const key = `${pieceKey(pet)}|${pet.stats.join("+")}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { pet, count: 1 });
  }
  return [...groups.values()].map(({ pet, count }) => {
    const stats = pet.stats.map((stat) => statName(snapshot, stat, LANGUAGE)).join(" + ");
    return `${petName(snapshot, pet, LANGUAGE)}${stats ? ` (${stats})` : ""}${count > 1 ? ` ×${count}` : ""}`;
  }).join(" · ");
}

const weaponName = (weapon: Build["weapon"]) => (weapon === "melee" ? "Melee" : weapon === "ranged" ? "Ranged" : "");

function buildLines(snapshot: BuildSnapshot, build: Build): string[] {
  const facts = [
    weaponName(build.weapon),
    build.fairy ? `${build.fairy} fairy` : "",
    build.arenaWinRate !== null ? `wins ${percent(build.arenaWinRate)} of arena fights` : "",
    build.quest ? `clears ${build.quest}` : "",
  ];
  const mount = build.mount
    ? `${mountName(snapshot, build.mount, LANGUAGE)}${build.mount.stats.length ? ` (${build.mount.stats.map((stat) => statName(snapshot, stat, LANGUAGE)).join(" + ")})` : ""}`
    : "";
  return [
    joined(facts),
    `**Skills:** ${joined(build.skills.map((skill) => skillName(snapshot, skill, LANGUAGE)))}`,
    build.pets.length ? `**Pets:** ${petsLine(snapshot, build.pets)}` : "",
    mount ? `**Mount:** ${mount}` : "",
    build.gear.length ? `**Gear rows:** ${build.gear.slice(0, 4).map((gear) => `(${gear.rows}) ${statName(snapshot, gear.stat, LANGUAGE)}`).join(" · ")}` : "",
  ].filter(Boolean);
}

function changesLine(changes: (BuildChanges & { since: string | null }) | null): string {
  if (!changes) return "";
  const parts = [
    changes.skillsIn.length ? `${joined(changes.skillsIn.map((names) => names.en))} in` : "",
    changes.skillsOut.length ? `${joined(changes.skillsOut.map((names) => names.en))} out` : "",
    changes.pet ? `top pet is now ${changes.pet.en}` : "",
    changes.arenaChanged ? "new Arena winner" : "",
  ].filter(Boolean);
  return parts.length ? `**Changed${changes.since ? ` since ${day(changes.since)}` : ""}:** ${parts.join(", ")}` : "";
}

/** The thread message for one build set: what the top builds share, then the best build of each goal. */
export function buildsMessage(
  snapshot: BuildSnapshot,
  options: { changes?: (BuildChanges & { since: string | null }) | null; replacedAt?: string | null; firstSeen?: string | null } = {},
): { content: string; embeds: BuildsEmbed[] } {
  const old = !!options.replacedAt;
  const when = day(snapshot.gameDate ?? options.firstSeen ?? null);
  const meta = snapshot.meta;
  const summary = [
    old ? `Replaced by newer builds on ${day(options.replacedAt!)}. Kept here for reference.` : "What the top builds have in common:",
    meta.skills.length ? `**Skills:** ${joined(meta.skills.map((skill) => skillName(snapshot, skill, LANGUAGE)))}` : "",
    meta.pet ? `**Pets:** ${petName(snapshot, meta.pet, LANGUAGE)}${meta.pet.stats.length ? ` with ${meta.pet.stats.map((stat) => statName(snapshot, stat, LANGUAGE)).join(" + ")}` : ""}` : "",
    meta.mountStats.length ? `**Mount:** ${meta.mountStats.map((stat) => statName(snapshot, stat, LANGUAGE)).join(" + ")}` : "",
    meta.gear.length ? `**Gear rows:** ${joined(meta.gear.map((stat) => statName(snapshot, stat, LANGUAGE)))}` : "",
    meta.arena ? `**Arena:** ${joined([weaponName(meta.arena.weapon), meta.arena.fairy ? `${meta.arena.fairy} fairy` : "", meta.arena.winRate !== null ? `wins ${percent(meta.arena.winRate)} of simulated fights` : ""])}` : "",
    old ? "" : changesLine(options.changes ?? null),
  ].filter(Boolean).join("\n");
  const embeds: BuildsEmbed[] = [{
    title: `${old ? "🗄️ Old builds" : "📈 Meta builds"}${when ? ` · ${when} game update` : ""}`,
    description: summary,
    color: old ? OLD_COLOR : SUMMARY_COLOR,
    fields: [],
    footer: "Max-level builds from 1vcian's fight simulator: aim for these stats as you grow.",
  }];
  for (const { goal, builds } of snapshot.goals) {
    const best = builds[0];
    if (!best) continue;
    const style = GOAL_STYLE[goal];
    embeds.push({ title: `${style.emoji} ${style.label}`, description: buildLines(snapshot, best).join("\n"), color: old ? OLD_COLOR : style.color, fields: [] });
  }
  return { content: old ? "" : "The best build for each goal right now. Older builds are further up this thread.", embeds: embeds.slice(0, 10) };
}

/** The short message in the channel that the thread hangs off. */
function introMessage(updated: string | null) {
  return {
    content: "",
    embeds: [{
      title: BUILDS_THREAD_NAME,
      description: [
        "The strongest builds right now, from 1vcian's Forge Master fight simulator. The Hub updates them after each game update.",
        "Open the thread below for the best build for each goal. Older builds stay in the thread.",
        updated ? `\n**Last updated:** ${day(updated)}` : "",
      ].filter(Boolean).join("\n"),
      color: SUMMARY_COLOR,
    }],
  };
}

function linkButtons() {
  return [{ type: 1, components: [
    { type: 2, style: 5, label: "Open the Builds page", url: `${appUrl()}/builds` },
    { type: 2, style: 5, label: "All builds on 1vcian", url: BUILDS_PAGE_URL },
  ] }];
}

function apiMessage(message: { content: string; embeds: BuildsEmbed[] }) {
  return {
    content: message.content,
    embeds: message.embeds.map((embed) => ({
      title: embed.title,
      description: embed.description,
      color: embed.color,
      ...(embed.fields.length ? { fields: embed.fields } : {}),
      ...(embed.footer ? { footer: { text: embed.footer } } : {}),
    })),
    components: linkButtons(),
    allowed_mentions: { parse: [] },
  };
}

interface DiscordSettings { enabled: boolean; introId: string | null; threadId: string | null; error: string | null }

async function settings(connection: SqlConnection): Promise<DiscordSettings> {
  const row = (await connection.query("SELECT discord_enabled, discord_intro_id, discord_thread_id, discord_error FROM build_sync WHERE id = 'clan'"))[0];
  return {
    enabled: row?.discord_enabled === true,
    introId: row?.discord_intro_id ? String(row.discord_intro_id) : null,
    threadId: row?.discord_thread_id ? String(row.discord_thread_id) : null,
    error: row?.discord_error ? String(row.discord_error) : null,
  };
}

interface SnapshotRow { id: number; data: BuildSnapshot; hash: string; messageId: string | null; postedHash: string | null; firstSeen: string | null; replacedAt: string | null }

async function snapshotRows(connection: SqlConnection): Promise<{ current: SnapshotRow | null; older: SnapshotRow[] }> {
  const sync = (await connection.query("SELECT current_id FROM build_sync WHERE id = 'clan'"))[0];
  const rows = await connection.query(`SELECT id, data, content_hash, discord_message_id, discord_posted_hash, first_seen, replaced_at
    FROM build_snapshots ORDER BY first_seen DESC, id DESC`);
  const mapped = rows.map((row) => ({
    id: Number(row.id),
    data: (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as BuildSnapshot,
    hash: String(row.content_hash),
    messageId: row.discord_message_id ? String(row.discord_message_id) : null,
    postedHash: row.discord_posted_hash ? String(row.discord_posted_hash) : null,
    firstSeen: iso(row.first_seen),
    replacedAt: iso(row.replaced_at),
  }));
  const currentId = sync?.current_id !== null && sync?.current_id !== undefined ? Number(sync.current_id) : mapped[0]?.id ?? null;
  return { current: mapped.find((row) => row.id === currentId) ?? null, older: mapped.filter((row) => row.id !== currentId) };
}

async function discordCall(fetcher: typeof fetch, token: string, path: string, method: string, body?: unknown): Promise<Response> {
  const response = await fetcher(`${DISCORD_API}${path}`, {
    method,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).catch(() => null);
  if (!response) throw new ApiError(502, "Couldn’t reach Discord.", "BUILDS_DISCORD_FAILED");
  return response;
}

/** Creates the channel message and its thread. */
async function openThread(connection: SqlConnection, fetcher: typeof fetch, token: string, updated: string | null): Promise<string> {
  const channel = channelId();
  const intro = await discordCall(fetcher, token, `/channels/${channel}/messages`, "POST", { ...introMessage(updated), components: linkButtons(), allowed_mentions: { parse: [] } });
  if (!intro.ok) throw new ApiError(502, `Discord didn’t take the builds message (${await discordReason(intro)}).`, "BUILDS_DISCORD_FAILED");
  const introId = String(((await intro.json()) as { id?: unknown }).id ?? "");
  const thread = await discordCall(fetcher, token, `/channels/${channel}/messages/${introId}/threads`, "POST", { name: BUILDS_THREAD_NAME, auto_archive_duration: 10080 });
  if (!thread.ok) throw new ApiError(502, `Discord didn’t open the builds thread (${await discordReason(thread)}).`, "BUILDS_DISCORD_FAILED");
  const threadId = String(((await thread.json()) as { id?: unknown }).id ?? "");
  if (!introId || !threadId) throw new ApiError(502, "Discord didn’t open the builds thread.", "BUILDS_DISCORD_FAILED");
  await connection.query(`INSERT INTO build_sync (id, discord_channel_id, discord_intro_id, discord_thread_id) VALUES ('clan', $1, $2, $3)
    ON CONFLICT (id) DO UPDATE SET discord_channel_id = EXCLUDED.discord_channel_id, discord_intro_id = EXCLUDED.discord_intro_id, discord_thread_id = EXCLUDED.discord_thread_id`,
  [channel, introId, threadId]);
  // A new thread holds none of the old messages.
  await connection.query("UPDATE build_snapshots SET discord_message_id = NULL, discord_posted_hash = NULL");
  return threadId;
}

/**
 * Brings the builds thread up to date: opens it the first time, posts a new message when a new
 * game update's builds come in (and greys out the one before it), and rewrites the message when
 * the same update's builds were redone. Does nothing while it's switched off.
 */
export async function syncBuildsThread(dependencies: { db?: Database | SqlConnection; fetcher?: typeof fetch } = {}): Promise<{ posted: boolean; edited: boolean; skipped?: string }> {
  const connection = dependencies.db ?? await database();
  const fetcher = dependencies.fetcher ?? fetch;
  const state = await settings(connection);
  if (!state.enabled) return { posted: false, edited: false, skipped: "off" };
  const token = botToken();
  if (!token) return { posted: false, edited: false, skipped: "no bot" };
  const { current, older } = await snapshotRows(connection);
  if (!current) return { posted: false, edited: false, skipped: "no builds" };
  if (current.messageId && current.postedHash === current.hash && state.threadId) return { posted: false, edited: false };
  try {
    let threadId = state.threadId;
    if (threadId) {
      // An idle thread gets archived by Discord after a week: wake it before writing in it.
      const woken = await discordCall(fetcher, token, `/channels/${threadId}`, "PATCH", { archived: false });
      if (woken.status === 404) threadId = null;
    }
    if (!threadId) threadId = await openThread(connection, fetcher, token, current.data.gameDate ?? current.firstSeen);
    const message = apiMessage(buildsMessage(current.data, { changes: await buildChanges(connection, current.data), firstSeen: current.firstSeen }));
    let posted = false;
    let edited = false;
    const fresh = await connection.query("SELECT discord_message_id FROM build_snapshots WHERE id = $1", [current.id]);
    const messageId = fresh[0]?.discord_message_id ? String(fresh[0].discord_message_id) : null;
    if (messageId) {
      const response = await discordCall(fetcher, token, `/channels/${threadId}/messages/${messageId}`, "PATCH", message);
      if (response.ok) edited = true;
      else if (response.status !== 404) throw new ApiError(502, `Discord didn’t take the updated builds (${await discordReason(response)}).`, "BUILDS_DISCORD_FAILED");
    }
    if (!edited) {
      // Grey out the builds this set replaces, then post the new set below them.
      for (const row of older.filter((entry) => entry.messageId && entry.postedHash !== "old")) {
        const old = apiMessage(buildsMessage(row.data, { replacedAt: row.replacedAt ?? new Date().toISOString(), firstSeen: row.firstSeen }));
        await discordCall(fetcher, token, `/channels/${threadId}/messages/${row.messageId}`, "PATCH", old).catch(() => null);
        await connection.query("UPDATE build_snapshots SET discord_posted_hash = 'old' WHERE id = $1", [row.id]);
      }
      const response = await discordCall(fetcher, token, `/channels/${threadId}/messages`, "POST", message);
      if (!response.ok) throw new ApiError(502, `Discord didn’t take the builds (${await discordReason(response)}).`, "BUILDS_DISCORD_FAILED");
      const id = String(((await response.json()) as { id?: unknown }).id ?? "");
      await connection.query("UPDATE build_snapshots SET discord_message_id = $2 WHERE id = $1", [current.id, id || null]);
      posted = true;
    }
    await connection.query("UPDATE build_snapshots SET discord_posted_hash = $2 WHERE id = $1", [current.id, current.hash]);
    // The channel message says when the builds last changed.
    const after = await settings(connection);
    if (after.introId) {
      await discordCall(fetcher, token, `/channels/${channelId()}/messages/${after.introId}`, "PATCH",
        { ...introMessage(current.data.gameDate ?? current.firstSeen), components: linkButtons(), allowed_mentions: { parse: [] } }).catch(() => null);
    }
    await connection.query("UPDATE build_sync SET discord_error = NULL WHERE id = 'clan'");
    return { posted, edited };
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Couldn’t update the builds thread.";
    await connection.query("UPDATE build_sync SET discord_error = $1 WHERE id = 'clan'", [message]);
    throw error;
  }
}

/** The Builds page as a member sees it, with the Discord side for leaders. */
export async function loadBuildsPage(actor: Member, db?: Database | SqlConnection): Promise<BuildsResponse> {
  const connection = db ?? await database();
  const page = await loadBuilds(actor, connection);
  if (!page.canEdit) return page;
  const state = await settings(connection);
  const discord: BuildsDiscordState = {
    enabled: state.enabled,
    channelId: channelId(),
    threadId: state.threadId,
    error: state.error,
    preview: page.current ? buildsMessage(page.current.data, { changes: page.changes, firstSeen: page.current.firstSeen }) : null,
  };
  return { ...page, discord };
}

/** Leaders: switch the builds thread on or off. Switching on posts it (the route does that afterwards). */
export async function updateBuildsSettings(actor: Member, input: { discordEnabled: boolean }, db?: Database | SqlConnection): Promise<BuildsResponse> {
  const connection = db ?? await database();
  await requireBuildsLeader(connection, actor.id);
  await connection.query(`INSERT INTO build_sync (id, discord_enabled, updated_by) VALUES ('clan', $1, $2)
    ON CONFLICT (id) DO UPDATE SET discord_enabled = EXCLUDED.discord_enabled, updated_by = EXCLUDED.updated_by`, [input.discordEnabled, actor.id]);
  return loadBuildsPage(actor, connection);
}

/** Leaders: check the site now (and bring the thread up to date), instead of waiting for the daily check. */
export async function refreshBuilds(actor: Member, dependencies: { db?: Database | SqlConnection; fetcher?: typeof fetch; now?: Date } = {}): Promise<BuildsResponse> {
  const connection = dependencies.db ?? await database();
  await requireBuildsLeader(connection, actor.id);
  await syncBuilds({ db: connection, fetcher: dependencies.fetcher, now: dependencies.now });
  await syncBuildsThread({ db: connection, fetcher: dependencies.fetcher }).catch(() => undefined);
  return loadBuildsPage(actor, connection);
}
