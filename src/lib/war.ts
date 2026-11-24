import type { ResourceEntry, WarActivity, WarEstimate, WarRates, WarTech } from "./types";

export const WAR_ACTIVITIES: readonly {
  key: WarActivity;
  label: string;
  description: string;
}[] = [
  { key: "hammers", label: "Hammers", description: "An estimated 2–5 points per hammer." },
  { key: "skillSummons", label: "Skill summons", description: "Whole estimated skill summons, using each member's saved cost for five skills." },
  { key: "mountSummons", label: "Mount summons", description: "Whole summons available from saved mount keys and summon cost." },
  { key: "newMountMerges", label: "Merge newly summoned mounts", description: "Expected bonus mounts: whole available mount summons × extra mount chance %." },
  { key: "mountMerges", label: "Merge existing mounts", description: "Existing mounts to merge; exclude mounts counted as newly summoned." },
  { key: "eggMerges", label: "Merge existing eggs/pets", description: "Total eggs/pets, assuming they will all be ascended and merged when needed." },
  { key: "eggSummonMerges", label: "Egg/pet summon then merge", description: "Expected bonus pets: eggshells ÷ 100 × extra pet summon %." },
];

export const DEFAULT_WAR_RATES: WarRates = {
  hammersMin: 2,
  hammersMax: 5,
  skillSummons: 225,
  mountSummons: 1080,
  newMountMerges: 1080,
  mountMerges: 1080,
  eggMerges: 2250,
  eggSummonMerges: 2250,
};

function whole(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0n;
  const integer = Math.floor(value);
  if (!Number.isSafeInteger(integer)) throw new WarEstimateError();
  return BigInt(integer);
}

function cost(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function available(quantity: bigint, unitCost: number): bigint {
  // Divide the decimal cost exactly, including legacy costs with more than
  // one decimal place, so a complete summon is never lost to binary rounding.
  const [coefficient, exponent = "0"] = unitCost.toString().toLowerCase().split("e");
  const [integer, fraction = ""] = coefficient.split(".");
  const numerator = BigInt(integer + fraction);
  const scale = fraction.length - Number(exponent);
  return scale >= 0
    ? quantity * 10n ** BigInt(scale) / numerator
    : quantity / (numerator * 10n ** BigInt(-scale));
}

export class WarEstimateError extends Error {
  readonly code = "ESTIMATE_TOO_LARGE";
  constructor() {
    super("This estimate is too large to calculate accurately. Reduce the scoring rates or resource counts.");
    this.name = "WarEstimateError";
  }
}

const ACTION_SCALE = 1_000_000n;
const SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

function chanceHundredths(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0n;
  return BigInt(Math.round(Math.min(value, 1000) * 100));
}

function safeNumber(value: bigint): number {
  if (value < 0n || value > SAFE_INTEGER) throw new WarEstimateError();
  return Number(value);
}

function actionQuantity(scaled: bigint): number {
  if (scaled < 0n || scaled > SAFE_INTEGER * ACTION_SCALE) throw new WarEstimateError();
  if (scaled <= SAFE_INTEGER) return Number(scaled) / Number(ACTION_SCALE);
  return Number(scaled / ACTION_SCALE) + Number(scaled % ACTION_SCALE) / Number(ACTION_SCALE);
}

function roundedPoints(scaledQuantity: bigint, rate: number, percent = 0): number {
  if (!Number.isSafeInteger(rate) || rate < 0) throw new WarEstimateError();
  // Keep fractional expected actions through the clan sum, then round points
  // once per activity. Every operand stays exact until the display conversion,
  // including the clan tech bonus (a whole percent).
  const bonus = BigInt(100 + Math.max(0, Math.round(percent)));
  const scale = ACTION_SCALE * 100n;
  return safeNumber((scaledQuantity * BigInt(rate) * bonus + scale / 2n) / scale);
}

/** Clan tech that adds war points to each activity, 4% a level (up to 10): hammers are forging. */
const SOURCE_TECH: Record<WarActivity, string> = {
  hammers: "war-points-from-forging",
  skillSummons: "war-points-from-skill-summon",
  mountSummons: "war-points-from-mount-summon",
  newMountMerges: "war-points-from-mount-merge",
  mountMerges: "war-points-from-mount-merge",
  eggMerges: "war-points-from-pet-merge",
  eggSummonMerges: "war-points-from-pet-merge",
};
export const WAR_TECH_PER_LEVEL = 4;

/** The clan's war point bonuses (percent) from its Clan Tech levels. */
export function warTechFromLevels(levels: Record<string, number>): WarTech {
  const percent = (key: string) => Math.max(0, Math.min(10, Math.floor(Number(levels[key]) || 0))) * WAR_TECH_PER_LEVEL;
  return {
    activity: Object.fromEntries(WAR_ACTIVITIES.map(({ key }) => [key, percent(SOURCE_TECH[key])])) as WarTech["activity"],
    day: Object.fromEntries([1, 2, 3, 4, 5, 6].map((day) => [day, percent(`war-points-on-day-${day}`)])),
  };
}

/**
 * Each activity's clan tech bonus (percent) on a war day: its "War Points From …" plus that day's
 * "War Points On Day …", added together. Without a day (a general estimate) the clan days' bonus
 * is the lowest of Days 1–5.
 */
export function warBoost(tech: WarTech | null | undefined, day: number | null): Partial<Record<WarActivity, number>> {
  if (!tech) return {};
  const onDay = day !== null && day >= 1 && day <= 6
    ? tech.day[day] ?? 0
    : Math.min(...[1, 2, 3, 4, 5].map((value) => tech.day[value] ?? 0));
  return Object.fromEntries(WAR_ACTIVITIES.map(({ key }) => [key, (tech.activity[key] ?? 0) + onDay]));
}

/** A rate with its clan tech bonus, for showing "points each". */
export function boostedRate(rate: number, percent = 0): number {
  return Math.round(rate * (100 + percent)) / 100;
}

/** Sum per-member actions; current chance estimates retain fractional expectations. */
export function estimateWar(
  entries: ResourceEntry[],
  rates: WarRates,
  activities: WarActivity[],
  mode: "current" | "historical" = "current",
  /** Clan tech bonus per activity, in percent (see warBoost). */
  boost: Partial<Record<WarActivity, number>> = {},
): WarEstimate {
  const selected = new Set(activities);
  const quantities: Record<WarActivity, bigint> = {
    hammers: 0n, skillSummons: 0n, mountSummons: 0n, newMountMerges: 0n,
    mountMerges: 0n, eggMerges: 0n, eggSummonMerges: 0n,
  };
  let missingCosts = 0;

  for (const entry of entries) {
    const tickets = whole(entry.resources.skillTickets);
    const keys = whole(entry.resources.mountKeys);
    const skillsCost = cost(entry.summoningCosts?.fiveSkills);
    const mountCost = cost(entry.summoningCosts?.mount);
    const plannedMountMerges = whole(entry.planningDetails?.newMountMerges);
    const mounts = mountCost ? available(keys, mountCost) : 0n;
    const details = entry.planningDetails;
    const usesChance = mode === "current" || details?.calculationVersion === 2 ||
      details?.extraMountChancePercent !== undefined || details?.extraPetSummonPercent !== undefined;
    const mountChance = chanceHundredths(details?.extraMountChancePercent);
    quantities.hammers += whole(entry.resources.hammers) * ACTION_SCALE;
    quantities.skillSummons += (skillsCost ? available(tickets * 5n, skillsCost) : 0n) * ACTION_SCALE;
    quantities.mountSummons += mounts * ACTION_SCALE;
    quantities.mountMerges += whole(entry.resources.mountsToMerge) * ACTION_SCALE;
    if (usesChance) {
      // A percentage with two decimals is hundredths/10,000; eggshells also
      // divide by 100. The common scale preserves both formulas exactly.
      quantities.newMountMerges += mounts * mountChance * 100n;
      quantities.eggMerges += whole(entry.resources.eggsPetsTotal) * ACTION_SCALE;
      quantities.eggSummonMerges += whole(entry.resources.eggshellsTotal) * chanceHundredths(details?.extraPetSummonPercent);
    } else {
      quantities.newMountMerges += (plannedMountMerges < mounts ? plannedMountMerges : mounts) * ACTION_SCALE;
      quantities.eggMerges += whole(details?.eggMerges) * ACTION_SCALE;
      quantities.eggSummonMerges += whole(details?.eggSummonMerges) * ACTION_SCALE;
    }
    if (selected.has("skillSummons") && tickets > 0n && !skillsCost) missingCosts++;
    if (
      !mountCost && keys > 0n &&
      (selected.has("mountSummons") || (selected.has("newMountMerges") && (usesChance ? mountChance > 0n : plannedMountMerges > 0n)))
    ) missingCosts++;
  }

  const rows = WAR_ACTIVITIES.filter(({ key }) => selected.has(key)).map(({ key, label }) => {
    const scaledQuantity = quantities[key];
    const minimumRate = key === "hammers" ? rates.hammersMin : rates[key];
    const maximumRate = key === "hammers" ? rates.hammersMax : rates[key];
    const percent = boost[key] ?? 0;
    return { activity: key, label, quantity: actionQuantity(scaledQuantity), minimum: roundedPoints(scaledQuantity, minimumRate, percent), maximum: roundedPoints(scaledQuantity, maximumRate, percent) };
  });
  return {
    rows,
    minimum: safeNumber(rows.reduce((sum, row) => sum + BigInt(row.minimum), 0n)),
    maximum: safeNumber(rows.reduce((sum, row) => sum + BigInt(row.maximum), 0n)),
    missingCosts,
  };
}
