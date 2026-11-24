import { createHash } from "node:crypto";
import {
  metaChanges, pieceKey, spacedName, BUILD_GOALS,
  type Build, type BuildArchiveEntry, type BuildGoal, type BuildMeta, type BuildNames, type BuildPiece, type BuildSkill, type BuildSnapshot,
  type BuildSnapshotResponse, type BuildsResponse, type GameNames,
} from "../builds";
import type { Member } from "../types";
import { database, type Database, type SqlConnection } from "./db";
import { ApiError } from "./errors";
import { iso } from "./mappers";
import { activeMember } from "./spending-order";

/**
 * 1vcian's Forge Master site keeps its files in an open-source (MIT) GitHub repository: the game
 * files of each game update, and the Preset Builds its simulator finds for them.
 */
export const BUILDS_SOURCE = "https://raw.githubusercontent.com/1vcian/fm/main/public/parsed_configs/";
/** The game's languages the Hub keeps names in. The game files have none for the Hub's other languages, which show English. */
const NAME_LANGUAGES = ["en", "zh-TW", "zh-CN", "ko", "ja", "es", "pt-BR", "fr", "de", "ru", "tr"];
/** Builds shown per goal: the best, then two runners-up. */
const PER_GOAL = 3;
const MAX_LINKS = 20;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const objects = (value: unknown): Json[] => list(value).map(obj).filter((entry): entry is Json => entry !== null);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** "2026_11_16_09_55" → when that game update's files came out (UTC). */
export function versionDate(version: string): string | null {
  const match = /^(\d{4})_(\d{2})_(\d{2})(?:_(\d{2})_(\d{2}))?$/.exec(version);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0"] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The site's game versions, newest first (its list isn't in order). */
export function newestVersions(versions: unknown): string[] {
  const dated = list(versions).map(text).filter((version): version is string => !!version && versionDate(version) !== null);
  return [...new Set(dated)].sort((a, b) => versionDate(b)!.localeCompare(versionDate(a)!));
}

/**
 * The names a version's builds file can have, the one the site shows first: each fairy season has
 * its own ("ProfilePresets.fairies_2026_11.json", from the month the season starts), then the plain
 * one. Seasons that haven't started yet are skipped.
 */
export function presetFileCandidates(now: Date): string[] {
  const names: string[] = [];
  for (let back = 0; back < 12; back += 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    names.push(`ProfilePresets.fairies_${month.getUTCFullYear()}_${String(month.getUTCMonth() + 1).padStart(2, "0")}.json`);
  }
  names.push("ProfilePresets.json");
  return names;
}

async function fetchJson(fetcher: typeof fetch, url: string): Promise<unknown | null> {
  const response = await fetcher(url, { cache: "no-store", headers: { Accept: "application/json" } }).catch(() => null);
  if (!response) throw new ApiError(502, "Couldn’t reach 1vcian’s site.", "BUILDS_UNREACHABLE");
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(502, `1vcian’s site answered with an error (${response.status}).`, "BUILDS_UNREACHABLE");
  return response.json().catch(() => {
    throw new ApiError(502, "1vcian’s site sent something that isn’t a builds file.", "BUILDS_UNREADABLE");
  });
}

export interface BuildSource { version: string; file: string; presets: unknown; localization: unknown }

/** The newest builds file on the site. A brand-new game update may not have builds yet: then the one before it. */
export async function fetchBuildSource(fetcher: typeof fetch, now: Date): Promise<BuildSource> {
  const versions = newestVersions(await fetchJson(fetcher, `${BUILDS_SOURCE}versions.json`));
  if (!versions.length) throw new ApiError(502, "1vcian’s site lists no game versions.", "BUILDS_MISSING");
  for (const version of versions.slice(0, 3)) {
    for (const file of presetFileCandidates(now)) {
      const presets = await fetchJson(fetcher, `${BUILDS_SOURCE}${version}/${file}`);
      if (!presets) continue;
      // Names in each language; the builds still show (in English) if they can't be had.
      const localization = await fetchJson(fetcher, `${BUILDS_SOURCE}Localization.json`).catch(() => null);
      return { version, file, presets, localization };
    }
  }
  throw new ApiError(502, "1vcian’s site has no builds for the latest game updates.", "BUILDS_MISSING");
}

/** One name per language the Hub uses, from a section of the game's localisation file. */
function namesFrom(section: Json | null, key: string, fallback: string): GameNames {
  const entry = obj(section?.[key]);
  const names: GameNames = {};
  for (const language of NAME_LANGUAGES) {
    const name = text(entry?.[language]);
    if (name) names[language] = name.slice(0, 60);
  }
  if (!names.en) names.en = fallback;
  return names;
}

const weaponOf = (value: unknown): Build["weapon"] => (value === "melee" || value === "ranged" ? value : null);

/** Most used first; ties keep the order they were first seen in. */
function ranked(ids: string[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
}

/** What the best build of each goal (healing aside, which plays differently) has in common. */
function metaOf(goals: BuildSnapshot["goals"]): BuildMeta {
  const heads = goals.filter((entry) => entry.goal !== "healing").map((entry) => entry.builds[0]).filter((build): build is Build => !!build);
  const skillsById = new Map(heads.flatMap((build) => build.skills).map((skill) => [skill.id, skill]));
  const needed = Math.min(2, heads.length);
  const skills = ranked(heads.flatMap((build) => build.skills.map((skill) => skill.id)))
    .filter((entry) => entry.count >= needed).slice(0, 3).map((entry) => skillsById.get(entry.id)!);
  const pets = heads.flatMap((build) => build.pets);
  const topPet = ranked(pets.map(pieceKey))[0];
  const kind = topPet ? pets.filter((pet) => pieceKey(pet) === topPet.id) : [];
  const pet: BuildPiece | null = kind[0] ? { ...kind[0], stats: ranked(kind.flatMap((entry) => entry.stats)).slice(0, 2).map((entry) => entry.id) } : null;
  const mountStats = ranked(heads.flatMap((build) => build.mount?.stats ?? [])).slice(0, 2).map((entry) => entry.id);
  const rows = new Map<string, number>();
  for (const build of heads) for (const gear of build.gear) rows.set(gear.stat, (rows.get(gear.stat) ?? 0) + gear.rows);
  const gear = [...rows].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([stat]) => stat);
  const arenaBest = goals.find((entry) => entry.goal === "arena")?.builds[0];
  return {
    skills,
    pet,
    mountStats,
    gear,
    arena: arenaBest ? { weapon: arenaBest.weapon, fairy: arenaBest.fairy, winRate: arenaBest.arenaWinRate } : null,
  };
}

/**
 * Boils a builds file from the site down to what the Builds page and the Discord thread show: the
 * best three builds for each goal, and what the top builds have in common.
 */
export function summarizeBuilds(presetsFile: unknown, localization: unknown, version: string, file: string): BuildSnapshot {
  const root = obj(presetsFile);
  const presets = objects(root?.presets);
  const localized = obj(localization);
  const names: BuildNames = { skills: {}, pets: {}, mounts: {}, stats: {} };
  const statIds = new Set<string>();
  const winRates = new Map<string, number>();
  const standings = objects(obj(root?.tournament)?.standings);
  for (const standing of standings) {
    const key = text(standing.key);
    const rate = number(standing.winRate);
    if (key && rate !== null) winRates.set(key, Math.max(0, Math.min(1, rate)));
  }
  const piece = (entry: Json, section: "pets" | "mounts"): BuildPiece | null => {
    const id = number(entry.id);
    const rarity = text(entry.rarity) ?? "";
    if (id === null) return null;
    const stats = objects(entry.secondaryStats).map((stat) => text(stat.statId)).filter((stat): stat is string => !!stat);
    stats.forEach((stat) => statIds.add(stat));
    const built = { id: String(id), rarity, stats };
    names[section][pieceKey(built)] ??= namesFrom(obj(localized?.[section]), pieceKey(built), `${rarity} ${section === "pets" ? "pet" : "mount"}`.trim());
    return built;
  };
  const toBuild = (preset: Json): Build | null => {
    const key = text(preset.key);
    const profile = obj(preset.profile);
    if (!key || !profile) return null;
    const skills: BuildSkill[] = objects(obj(profile.skills)?.equipped).flatMap((skill) => {
      const id = text(skill.id);
      if (!id) return [];
      names.skills[id] ??= namesFrom(obj(localized?.skills), id, spacedName(id));
      return [{ id, rarity: text(skill.rarity) ?? "" }];
    });
    const pets = objects(obj(profile.pets)?.active).map((pet) => piece(pet, "pets")).filter((pet): pet is BuildPiece => !!pet);
    const mountEntry = obj(obj(profile.mount)?.active);
    const rows = new Map<string, number>();
    for (const item of Object.values(obj(profile.items) ?? {})) {
      for (const stat of objects(obj(item)?.secondaryStats)) {
        const id = text(stat.statId);
        if (id) rows.set(id, (rows.get(id) ?? 0) + 1);
      }
    }
    [...rows.keys()].forEach((stat) => statIds.add(stat));
    return {
      key,
      title: (text(preset.name) ?? key).slice(0, 120),
      weapon: weaponOf(preset.weapons),
      fairy: text(obj(obj(profile.misc)?.fairy)?.name)?.slice(0, 30) ?? null,
      skills,
      pets,
      mount: mountEntry ? piece(mountEntry, "mounts") : null,
      gear: [...rows].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([stat, count]) => ({ stat, rows: count })),
      arenaWinRate: winRates.get(key) ?? null,
      quest: text(obj(obj(preset.metrics)?.quest)?.label)?.slice(0, 40) ?? null,
    };
  };
  const builds = new Map<string, { preset: Json; build: Build }>();
  for (const preset of presets) {
    const build = toBuild(preset);
    if (build && !builds.has(build.key)) builds.set(build.key, { preset, build });
  }
  const category = (name: string) => [...builds.values()]
    .filter((entry) => entry.preset.category === name)
    .sort((a, b) => (number(a.preset.rank) ?? 99) - (number(b.preset.rank) ?? 99));
  const healing = (entry: { preset: Json }) => number(obj(entry.preset.metrics)?.testedHps) ?? number(obj(entry.preset.metrics)?.hps) ?? 0;
  const arena = standings.length
    ? standings.map((standing) => builds.get(text(standing.key) ?? "")).filter((entry): entry is { preset: Json; build: Build } => !!entry)
    : category("lab");
  const picks: Record<BuildGoal, { build: Build }[]> = {
    arena,
    quest: category("quest"),
    dpsMelee: category("dpsMelee"),
    dpsRanged: category("dpsRanged"),
    healing: [...category("hpsMelee"), ...category("hpsRanged")].sort((a, b) => healing(b) - healing(a)),
  };
  const goals = BUILD_GOALS
    .map((goal) => ({ goal, builds: picks[goal].slice(0, PER_GOAL).map((entry) => entry.build) }))
    .filter((entry) => entry.builds.length > 0);
  if (!goals.length) throw new ApiError(502, "1vcian’s builds file has no builds the Hub can read.", "BUILDS_UNREADABLE");
  for (const stat of [...statIds].sort()) names.stats[stat] = namesFrom(obj(localized?.substats), stat, spacedName(stat));
  // Only the names of what is shown.
  const shown = goals.flatMap((entry) => entry.builds);
  const keep = <T,>(record: Record<string, T>, keys: Set<string>) => Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));
  names.skills = keep(names.skills, new Set(shown.flatMap((build) => build.skills.map((skill) => skill.id))));
  names.pets = keep(names.pets, new Set(shown.flatMap((build) => build.pets.map(pieceKey))));
  names.mounts = keep(names.mounts, new Set(shown.flatMap((build) => (build.mount ? [pieceKey(build.mount)] : []))));
  names.stats = keep(names.stats, new Set(shown.flatMap((build) => [...build.gear.map((gear) => gear.stat), ...build.pets.flatMap((pet) => pet.stats), ...(build.mount?.stats ?? [])])));
  return { version, file, gameDate: versionDate(version), goals, meta: metaOf(goals), names };
}

const hashOf = (snapshot: BuildSnapshot) => createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

export interface BuildSyncResult { changed: boolean; snapshotId: number | null; version: string | null; error?: string }

/**
 * The daily check (and a leader's "Check now"): pulls the newest builds from the site. A new game
 * update's builds become the current set and the old set joins the archive. Builds redone for the
 * same update replace the current set. When the site can't be read, the last good set stays.
 */
export async function syncBuilds(dependencies: { db?: Database | SqlConnection; fetcher?: typeof fetch; now?: Date } = {}): Promise<BuildSyncResult> {
  const connection = dependencies.db ?? await database();
  const now = dependencies.now ?? new Date();
  let snapshot: BuildSnapshot;
  try {
    const source = await fetchBuildSource(dependencies.fetcher ?? fetch, now);
    snapshot = summarizeBuilds(source.presets, source.localization, source.version, source.file);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : "Couldn’t read the builds from 1vcian’s site.";
    await connection.query(`INSERT INTO build_sync (id, error, error_at) VALUES ('clan', $1, $2)
      ON CONFLICT (id) DO UPDATE SET error = EXCLUDED.error, error_at = EXCLUDED.error_at`, [message, now.toISOString()]);
    return { changed: false, snapshotId: null, version: null, error: message };
  }
  const hash = hashOf(snapshot);
  const at = now.toISOString();
  const run = async (tx: SqlConnection) => {
    const sync = await tx.query("SELECT current_id FROM build_sync WHERE id = 'clan'");
    const currentId = sync[0]?.current_id === null || sync[0]?.current_id === undefined ? null : Number(sync[0].current_id);
    let changed = false;
    let rows = await tx.query("SELECT id, content_hash FROM build_snapshots WHERE source_version = $1 AND source_file = $2", [snapshot.version, snapshot.file]);
    if (!rows.length) {
      rows = await tx.query(`INSERT INTO build_snapshots (source_version, source_file, game_date, content_hash, data, first_seen, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (source_version, source_file) DO NOTHING RETURNING id, content_hash`,
      [snapshot.version, snapshot.file, snapshot.gameDate, hash, JSON.stringify(snapshot), at]);
      if (rows.length) changed = true;
      else rows = await tx.query("SELECT id, content_hash FROM build_snapshots WHERE source_version = $1 AND source_file = $2", [snapshot.version, snapshot.file]);
    }
    const id = Number(rows[0].id);
    if (String(rows[0].content_hash) !== hash) {
      await tx.query("UPDATE build_snapshots SET data = $2, content_hash = $3, game_date = $4, updated_at = $5, replaced_at = NULL, discord_posted_hash = NULL WHERE id = $1",
        [id, JSON.stringify(snapshot), hash, snapshot.gameDate, at]);
      changed = true;
    }
    if (currentId !== id) {
      if (currentId !== null) await tx.query("UPDATE build_snapshots SET replaced_at = $2 WHERE id = $1 AND replaced_at IS NULL", [currentId, at]);
      await tx.query("UPDATE build_snapshots SET replaced_at = NULL WHERE id = $1", [id]);
      changed = true;
    }
    await tx.query(`INSERT INTO build_sync (id, current_id, checked_at, error, error_at) VALUES ('clan', $1, $2, NULL, NULL)
      ON CONFLICT (id) DO UPDATE SET current_id = EXCLUDED.current_id, checked_at = EXCLUDED.checked_at, error = NULL, error_at = NULL`, [id, at]);
    return { changed, snapshotId: id, version: snapshot.version };
  };
  return "transaction" in connection ? (connection as Database).transaction(run) : run(connection);
}

function archiveEntry(row: Record<string, unknown>): BuildArchiveEntry {
  return {
    id: Number(row.id),
    version: String(row.source_version),
    gameDate: iso(row.game_date),
    firstSeen: iso(row.first_seen)!,
    replacedAt: iso(row.replaced_at),
  };
}

const snapshotData = (value: unknown): BuildSnapshot => (typeof value === "string" ? JSON.parse(value) : value) as BuildSnapshot;

/** The current build set; with the Discord side added by the caller for leaders. */
export async function loadBuilds(actor: Member, db?: Database | SqlConnection): Promise<BuildsResponse> {
  const connection = db ?? await database();
  const me = await activeMember(connection, actor.id);
  const leader = me.role === "ADMIN";
  const sync = (await connection.query("SELECT current_id, checked_at, error FROM build_sync WHERE id = 'clan'"))[0];
  const rows = await connection.query("SELECT id, source_version, game_date, first_seen, updated_at, replaced_at FROM build_snapshots ORDER BY first_seen DESC, id DESC");
  const currentId = sync?.current_id !== null && sync?.current_id !== undefined ? Number(sync.current_id) : rows[0] ? Number(rows[0].id) : null;
  const currentRow = rows.find((row) => Number(row.id) === currentId) ?? null;
  let current: BuildsResponse["current"] = null;
  if (currentRow) {
    const data = snapshotData((await connection.query("SELECT data FROM build_snapshots WHERE id = $1", [currentId]))[0]?.data);
    current = { ...archiveEntry(currentRow), updatedAt: iso(currentRow.updated_at)!, data };
  }
  const changes = current ? await buildChanges(connection, current.data) : null;
  const links = await connection.query("SELECT id, title, url, note FROM build_links ORDER BY created_at, id");
  return {
    current,
    changes,
    archive: rows.filter((row) => Number(row.id) !== currentId).map(archiveEntry),
    links: links.map((row) => ({ id: Number(row.id), title: String(row.title), url: String(row.url), note: String(row.note ?? "") })),
    checkedAt: iso(sync?.checked_at),
    canEdit: leader,
    error: leader && sync?.error ? String(sync.error) : null,
    discord: null,
  };
}

/** What changed since the set seen just before the current one, or null when nothing a member would notice did. */
export async function buildChanges(connection: SqlConnection, currentData?: BuildSnapshot): Promise<BuildsResponse["changes"]> {
  const sync = (await connection.query("SELECT current_id FROM build_sync WHERE id = 'clan'"))[0];
  const rows = await connection.query("SELECT id, first_seen FROM build_snapshots ORDER BY first_seen DESC, id DESC");
  const index = rows.findIndex((row) => Number(row.id) === Number(sync?.current_id ?? rows[0]?.id));
  const previousRow = index >= 0 ? rows[index + 1] : undefined;
  if (!previousRow) return null;
  const data = currentData ?? snapshotData((await connection.query("SELECT data FROM build_snapshots WHERE id = $1", [rows[index].id]))[0]?.data);
  const previous = snapshotData((await connection.query("SELECT data FROM build_snapshots WHERE id = $1", [previousRow.id]))[0]?.data);
  const found = data?.meta && previous?.meta && previous.names ? metaChanges(data, previous) : null;
  return found ? { ...found, since: previous.gameDate ?? iso(previousRow.first_seen) } : null;
}

/** An older build set from the archive. */
export async function loadBuildSnapshot(actor: Member, id: number, db?: Database | SqlConnection): Promise<BuildSnapshotResponse> {
  const connection = db ?? await database();
  await activeMember(connection, actor.id);
  const rows = await connection.query("SELECT id, source_version, game_date, first_seen, replaced_at, data FROM build_snapshots WHERE id = $1", [id]);
  if (!rows.length) throw new ApiError(404, "Those builds aren’t in the archive.", "BUILDS_NOT_FOUND");
  return { ...archiveEntry(rows[0]), data: snapshotData(rows[0].data) };
}

export async function requireBuildsLeader(connection: SqlConnection, actorId: string): Promise<Member> {
  const member = await activeMember(connection, actorId);
  if (member.role !== "ADMIN") throw new ApiError(403, "Only leaders can change the Builds page.", "ADMIN_REQUIRED");
  return member;
}

/** Leaders: a link to another guide (a Discord post, a video, a site). */
export async function addBuildLink(actor: Member, input: { title: string; url: string; note?: string }, db?: Database | SqlConnection): Promise<void> {
  const connection = db ?? await database();
  await requireBuildsLeader(connection, actor.id);
  const count = await connection.query("SELECT COUNT(*)::int AS count FROM build_links");
  if (Number(count[0]?.count ?? 0) >= MAX_LINKS) throw new ApiError(400, `The page holds up to ${MAX_LINKS} links. Remove one first.`, "TOO_MANY_LINKS");
  await connection.query("INSERT INTO build_links (title, url, note, added_by) VALUES ($1, $2, $3, $4)", [input.title, input.url, input.note ?? "", actor.id]);
}

export async function removeBuildLink(actor: Member, id: number, db?: Database | SqlConnection): Promise<void> {
  const connection = db ?? await database();
  await requireBuildsLeader(connection, actor.id);
  await connection.query("DELETE FROM build_links WHERE id = $1", [id]);
}
