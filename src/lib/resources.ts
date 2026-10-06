export const RARITIES = [
  "Common",
  "Rare",
  "Epic",
  "Legendary",
  "Ultimate",
  "Mythic",
] as const;
export const RESOURCE_FIELDS = [
  { key: "skillTickets", label: "Skill Tickets", category: "essentials" },
  { key: "eggsPetsTotal", label: "Total eggs/pets", category: "essentials" },
  { key: "mountKeys", label: "Mount Keys", category: "essentials" },
  { key: "mountsToMerge", label: "Mounts to Merge", category: "essentials" },
  { key: "hammers", label: "Hammers", category: "essentials" },
  { key: "potions", label: "Potions", category: "essentials" },
] as const;
export type ResourceKey =
  | "skillTickets"
  | "eggsPetsTotal"
  | "mountKeys"
  | "mountsToMerge"
  | "hammers"
  | "potions";
export type ResourceValues = Record<ResourceKey, number>;
export interface SummoningCosts {
  fiveSkills: number;
  mount: number;
}
export const EMPTY_SUMMONING_COSTS: SummoningCosts = { fiveSkills: 0, mount: 0 };
export const MOUNT_SUMMON_COST_MIN = 37.5;
export const MOUNT_SUMMON_COST_MAX = 50;
export const SKILL_SUMMON_COST_MIN = 150;
export const SKILL_SUMMON_COST_MAX = 200;
export function skillCostHasValidPrecision(value: number): boolean {
  return Number.isInteger(value * 10);
}
export const EMPTY_RESOURCES = Object.fromEntries(
  RESOURCE_FIELDS.map(({ key }) => [key, 0]),
) as ResourceValues;
type LegacyEggsPetsKey = `eggs${(typeof RARITIES)[number]}` | `pets${(typeof RARITIES)[number]}`;
export const LEGACY_EGGS_PETS_KEYS = RARITIES.flatMap((rarity) => [
  `eggs${rarity}`,
  `pets${rarity}`,
]) as LegacyEggsPetsKey[];
export function resourceMaximum(key: ResourceKey): number {
  return key === "eggsPetsTotal" ? 12_000_000_000 : 1_000_000_000;
}
export function normalizeResources(value: unknown): ResourceValues {
  const stored = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const numeric = (key: string): number => typeof stored[key] === "number" && Number.isFinite(stored[key]) ? stored[key] : 0;
  const normalized = { ...EMPTY_RESOURCES };
  for (const { key } of RESOURCE_FIELDS) {
    normalized[key] = numeric(key);
  }
  // An explicit zero is authoritative; only legacy rows lacking a numeric
  // combined field derive their total from the former rarity counts.
  if (typeof stored.eggsPetsTotal !== "number" || !Number.isFinite(stored.eggsPetsTotal)) {
    normalized.eggsPetsTotal = LEGACY_EGGS_PETS_KEYS.reduce((total, key) => total + numeric(key), 0);
  }
  return normalized;
}
export const numberFormat = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);
export function currentWeek(date = new Date()): string {
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}
export function shiftWeek(week: string, by: number): string {
  const date = new Date(`${week}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by * 7);
  return date.toISOString().slice(0, 10);
}
export function formatWeek(week: string): string {
  return new Date(`${week}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
