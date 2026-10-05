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
  ...RARITIES.map((rarity) => ({
    key: `eggs${rarity}`,
    label: `${rarity} Eggs`,
    category: "eggs",
  })),
  ...RARITIES.map((rarity) => ({
    key: `pets${rarity}`,
    label: `${rarity} Pets`,
    category: "pets",
  })),
  { key: "mountKeys", label: "Mount Keys", category: "essentials" },
  { key: "mountsToMerge", label: "Mounts to Merge", category: "essentials" },
  { key: "hammers", label: "Hammers", category: "essentials" },
  { key: "potions", label: "Potions", category: "essentials" },
] as const;
export type ResourceKey =
  | "skillTickets"
  | `eggs${(typeof RARITIES)[number]}`
  | `pets${(typeof RARITIES)[number]}`
  | "mountKeys"
  | "mountsToMerge"
  | "hammers"
  | "potions";
export type ResourceValues = Record<ResourceKey, number>;
export const EMPTY_RESOURCES = Object.fromEntries(
  RESOURCE_FIELDS.map(({ key }) => [key, 0]),
) as ResourceValues;
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
