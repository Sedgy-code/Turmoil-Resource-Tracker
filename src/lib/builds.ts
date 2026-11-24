/**
 * Builds: the strongest Forge Master builds of the moment, pulled every day from 1vcian's site. Its
 * Preset Builds page is a fight simulator that tries the builds the game allows, everything at its
 * maximum level, so the builds show what to aim for. The Hub keeps one snapshot per game update,
 * boiled down to one card per goal, and keeps the older ones as an archive.
 */

/** 1vcian's Preset Builds page, where every build in a snapshot can be looked at in full. */
export const BUILDS_PAGE_URL = "https://1vcian.me/fm/#/presets";
/** Turmoil's own build guide in Discord (#🛡️-build-guide): which stats to aim for at each stage. */
export const DISCORD_BUILD_GUIDE_URL = "https://discord.com/channels/1472488568596467778/1560553340931276950";

export const BUILD_GOALS = ["arena", "quest", "dpsMelee", "dpsRanged", "healing"] as const;
export type BuildGoal = (typeof BUILD_GOALS)[number];

/** A name as the game writes it, keyed by the game's own language codes ("en" is always there). */
export type GameNames = Record<string, string>;

export interface BuildSkill { id: string; rarity: string }
/** A pet or a mount, with the stats it rolls (stat ids). */
export interface BuildPiece { id: string; rarity: string; stats: string[] }
/** How many stat rows of one stat the gear carries. */
export interface BuildGear { stat: string; rows: number }

export interface Build {
  key: string;
  /** The build's name on 1vcian's site, to find it there. */
  title: string;
  weapon: "melee" | "ranged" | null;
  fairy: string | null;
  skills: BuildSkill[];
  pets: BuildPiece[];
  mount: BuildPiece | null;
  gear: BuildGear[];
  /** Share of its simulated arena fights won against the other top builds, when it was in them. */
  arenaWinRate: number | null;
  /** Furthest main quest battle it clears, as the site writes it ("Extreme 4-14"). */
  quest: string | null;
}

/** What the top builds have in common. */
export interface BuildMeta {
  skills: BuildSkill[];
  pet: BuildPiece | null;
  mountStats: string[];
  gear: string[];
  arena: { weapon: "melee" | "ranged" | null; fairy: string | null; winRate: number | null } | null;
}

export interface BuildSnapshot {
  /** The game files' version on the site ("2026_11_16_09_55"). */
  version: string;
  file: string;
  /** When that game update came out, from the version. */
  gameDate: string | null;
  goals: { goal: BuildGoal; builds: Build[] }[];
  meta: BuildMeta;
  /** The game's names, in each language, for everything above (pets and mounts by "Rarity_id"). */
  names: BuildNames;
}

export interface BuildNames {
  skills: Record<string, GameNames>;
  pets: Record<string, GameNames>;
  mounts: Record<string, GameNames>;
  stats: Record<string, GameNames>;
}

export interface BuildChanges {
  skillsIn: GameNames[];
  skillsOut: GameNames[];
  /** The new top pet, when it changed. */
  pet: GameNames | null;
  arenaChanged: boolean;
}

export interface BuildArchiveEntry { id: number; version: string; gameDate: string | null; firstSeen: string; replacedAt: string | null }
export interface BuildLink { id: number; title: string; url: string; note: string }

export interface BuildsDiscordState {
  enabled: boolean;
  channelId: string;
  threadId: string | null;
  error: string | null;
  preview: { content: string; embeds: BuildsEmbed[] } | null;
}

export interface BuildsEmbed {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer?: string;
}

export interface BuildsResponse {
  current: (BuildArchiveEntry & { updatedAt: string; data: BuildSnapshot }) | null;
  /** What changed since the build set before this one. */
  changes: (BuildChanges & { since: string | null }) | null;
  archive: BuildArchiveEntry[];
  links: BuildLink[];
  checkedAt: string | null;
  canEdit: boolean;
  /** Leaders only: why the last daily check failed, if it did. */
  error: string | null;
  /** Leaders only. */
  discord: BuildsDiscordState | null;
}

export interface BuildSnapshotResponse extends BuildArchiveEntry { data: BuildSnapshot }

/** The game's language codes for the Hub's languages that differ from them. */
const GAME_LANGUAGE: Record<string, string> = { "zh-Hant": "zh-TW", "zh-Hans": "zh-CN", pt: "pt-BR" };

/** "InfiniteRenewal" → "Infinite Renewal", for anything the game files have no name for. */
export function spacedName(id: string): string {
  return id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
}

/** The game's own name in the member's language, or the English one where the game has none. */
export function gameName(names: GameNames | undefined, language: string, fallback = ""): string {
  if (!names) return fallback;
  return names[GAME_LANGUAGE[language] ?? language] || names.en || fallback;
}

export const pieceKey = (piece: Pick<BuildPiece, "id" | "rarity">) => `${piece.rarity}_${piece.id}`;

type Named = Pick<BuildSnapshot, "names">;
export const statName = (snapshot: Named, stat: string, language: string) => gameName(snapshot.names.stats[stat], language, spacedName(stat));
export const skillName = (snapshot: Named, skill: BuildSkill, language: string) => gameName(snapshot.names.skills[skill.id], language, spacedName(skill.id));
export const petName = (snapshot: Named, pet: BuildPiece, language: string) => gameName(snapshot.names.pets[pieceKey(pet)], language, `${pet.rarity} pet`);
export const mountName = (snapshot: Named, mount: BuildPiece, language: string) => gameName(snapshot.names.mounts[pieceKey(mount)], language, `${mount.rarity} mount`);

/** What changed between two build sets, or null when nothing a member would notice did. */
export function metaChanges(current: BuildSnapshot, previous: BuildSnapshot): BuildChanges | null {
  const now = new Set(current.meta.skills.map((skill) => skill.id));
  const before = new Set(previous.meta.skills.map((skill) => skill.id));
  const names = (snapshot: BuildSnapshot, skill: BuildSkill) => snapshot.names.skills[skill.id] ?? { en: spacedName(skill.id) };
  const skillsIn = current.meta.skills.filter((skill) => !before.has(skill.id)).map((skill) => names(current, skill));
  const skillsOut = previous.meta.skills.filter((skill) => !now.has(skill.id)).map((skill) => names(previous, skill));
  const petChanged = !!current.meta.pet && (!previous.meta.pet || pieceKey(current.meta.pet) !== pieceKey(previous.meta.pet));
  const pet = petChanged && current.meta.pet ? current.names.pets[pieceKey(current.meta.pet)] ?? { en: `${current.meta.pet.rarity} pet` } : null;
  const arenaChanged = !!current.meta.arena && !!previous.meta.arena
    && (current.meta.arena.weapon !== previous.meta.arena.weapon || current.meta.arena.fairy !== previous.meta.arena.fairy);
  return skillsIn.length || skillsOut.length || pet || arenaChanged ? { skillsIn, skillsOut, pet, arenaChanged } : null;
}
