import type { ResourceEntry, WarActivity, WarEstimate, WarRates } from "./types";

export const WAR_ACTIVITIES: readonly {
  key: WarActivity;
  label: string;
  description: string;
}[] = [
  { key: "hammers", label: "Hammers", description: "An estimated 2–5 points per hammer." },
  { key: "skillSummons", label: "Skill summons", description: "Whole estimated skill summons, using each member's saved cost for five skills." },
  { key: "mountSummons", label: "Mount summons", description: "Whole summons available from saved mount keys and summon cost." },
  { key: "newMountMerges", label: "Merge newly summoned mounts", description: "Explicit planned merges, limited to the number of available mount summons." },
  { key: "mountMerges", label: "Merge existing mounts", description: "Existing mounts to merge; exclude mounts counted as newly summoned." },
  { key: "eggMerges", label: "Merge existing eggs/pets", description: "Explicit planned merges; exclude eggs/pets counted under summon then merge." },
  { key: "eggSummonMerges", label: "Egg/pet summon then merge", description: "Explicit planned actions; no conversion is inferred from the combined eggs/pets total." },
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

function whole(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function cost(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function available(quantity: number, unitCost: number): number {
  // Saved costs have at most one decimal place. Integer division avoids
  // discarding a complete action because a decimal cost rounded in binary.
  const scaled = unitCost * 10;
  const rounded = Math.round(scaled);
  return rounded > 0 && Math.abs(scaled - rounded) < 1e-7
    ? Math.floor((quantity * 10) / rounded)
    : Math.floor(quantity / unitCost);
}

export class WarEstimateError extends Error {
  readonly code = "ESTIMATE_TOO_LARGE";
  constructor() {
    super("This estimate is too large to calculate accurately. Reduce the scoring rates or resource counts.");
    this.name = "WarEstimateError";
  }
}

function safePoints(points: number): number {
  if (!Number.isSafeInteger(points)) throw new WarEstimateError();
  return points;
}

/** Sum each member's whole actions: spare tickets and keys cannot be pooled. */
export function estimateWar(
  entries: ResourceEntry[],
  rates: WarRates,
  activities: WarActivity[],
): WarEstimate {
  const selected = new Set(activities);
  const quantities: Record<WarActivity, number> = {
    hammers: 0, skillSummons: 0, mountSummons: 0, newMountMerges: 0,
    mountMerges: 0, eggMerges: 0, eggSummonMerges: 0,
  };
  let missingCosts = 0;

  for (const entry of entries) {
    const tickets = whole(entry.resources.skillTickets);
    const keys = whole(entry.resources.mountKeys);
    const skillsCost = cost(entry.summoningCosts?.fiveSkills);
    const mountCost = cost(entry.summoningCosts?.mount);
    const plannedMountMerges = whole(entry.planningDetails?.newMountMerges);
    const mounts = mountCost ? available(keys, mountCost) : 0;
    quantities.hammers += whole(entry.resources.hammers);
    quantities.skillSummons += skillsCost ? available(tickets * 5, skillsCost) : 0;
    quantities.mountSummons += mounts;
    quantities.newMountMerges += Math.min(plannedMountMerges, mounts);
    quantities.mountMerges += whole(entry.resources.mountsToMerge);
    quantities.eggMerges += whole(entry.planningDetails?.eggMerges);
    quantities.eggSummonMerges += whole(entry.planningDetails?.eggSummonMerges);
    if (selected.has("skillSummons") && tickets > 0 && !skillsCost) missingCosts++;
    if (
      !mountCost && keys > 0 &&
      (selected.has("mountSummons") || (selected.has("newMountMerges") && plannedMountMerges > 0))
    ) missingCosts++;
  }

  const rows = WAR_ACTIVITIES.filter(({ key }) => selected.has(key)).map(({ key, label }) => {
    const quantity = quantities[key];
    const minimumRate = key === "hammers" ? rates.hammersMin : rates[key];
    const maximumRate = key === "hammers" ? rates.hammersMax : rates[key];
    return { activity: key, label, quantity, minimum: safePoints(quantity * minimumRate), maximum: safePoints(quantity * maximumRate) };
  });
  return {
    rows,
    minimum: rows.reduce((sum, row) => safePoints(sum + row.minimum), 0),
    maximum: rows.reduce((sum, row) => safePoints(sum + row.maximum), 0),
    missingCosts,
  };
}
