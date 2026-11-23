import { DAY_ACTIVITIES, SPENDING_DAYS } from "./clan-day-planner";
import type { PlanningDetails, ResourceKey } from "./resources";
import type { AscendCheck, AscensionPillar, GuideRarity, Member, ResourceEntry, SpendOrder, SpendResource, SpendRow, WarActivity, WarRates } from "./types";
import { estimateWar } from "./war";
import { nextWarWeek, warDay, warWeekOf } from "./war-calendar";

/*
 * The spending order: who spends first on a clan day, so members can see where they stand instead
 * of asking. One line per pillar whose resources score on clan days (hammers have no line). Members
 * in that day's snipe go first, then the biggest stockpile, measured in the war points it can score
 * (the same estimate as the snipe planner). Members away on holiday are skipped.
 */

export const SPEND_RESOURCES: readonly SpendResource[] = ["skills", "pets", "mounts"];

export const SPEND_INFO: Record<SpendResource, {
  /** English name (translated by the interface; listed in i18n/indirect-keys.mjs). */
  label: string;
  pillar: AscensionPillar;
  /** War activities this pillar's resources score with. */
  activities: readonly WarActivity[];
  /** The saved amounts shown beside each member. */
  amounts: readonly ResourceKey[];
  /** The summon currency the ascension guide counts. */
  currency: ResourceKey;
  /** The member's summon level for this pillar (My Resources). */
  level: keyof Pick<PlanningDetails, "skillLevel" | "eggLevel" | "mountLevel">;
}> = {
  skills: { label: "Skills", pillar: "skills", activities: ["skillSummons"], amounts: ["skillTickets"], currency: "skillTickets", level: "skillLevel" },
  pets: { label: "Pets", pillar: "pets", activities: ["eggMerges", "eggSummonMerges"], amounts: ["eggsPetsTotal", "eggshellsTotal"], currency: "eggshellsTotal", level: "eggLevel" },
  mounts: { label: "Mounts", pillar: "mounts", activities: ["mountSummons", "newMountMerges", "mountMerges"], amounts: ["mountKeys", "mountsToMerge"], currency: "mountKeys", level: "mountLevel" },
};

/** The war days (1–5) where a resource scores: Skills on 1 and 3, Pets on 3 and 5, Mounts on 2 and 4. */
export function scoringDays(resource: SpendResource): number[] {
  const activities = SPEND_INFO[resource].activities;
  return SPENDING_DAYS.filter((day) => DAY_ACTIVITIES[day].some((activity) => activities.includes(activity)));
}

/** The lines that matter on a war day (Day 3: Skills and Pets). */
export function resourcesOnDay(day: number): SpendResource[] {
  return SPEND_RESOURCES.filter((resource) => scoringDays(resource).includes(day));
}

/**
 * Which war the order is for. Days 1–5 are this war's spending days; on Day 6 (battle) and Day 7
 * (claim) the spending is over, so the order is for the next war.
 */
export function orderWeek(now = new Date()): { week: string; warDay: number; nextWar: boolean } {
  const { day } = warDay(now);
  const nextWar = day >= 6;
  return { week: nextWar ? nextWarWeek(now) : warWeekOf(now), warDay: day, nextWar };
}

/**
 * The clan day a line is for: today when it's a clan day where the resource scores, otherwise the
 * next one in that war; null when leadership hasn't picked one (or none are left).
 */
export function orderDay(resource: SpendResource, clanDays: readonly number[], today: number, nextWar: boolean): { day: number | null; today: boolean } {
  const scoring = scoringDays(resource);
  const from = nextWar ? 1 : today;
  const day = [...clanDays].sort((a, b) => a - b).find((item) => item >= from && scoring.includes(item)) ?? null;
  return { day, today: !nextWar && day === today };
}

/*
 * The official Forge Master Discord's "Comprehensive Ascension Guide" (#guides-and-tips): what to save
 * before a first ascension (base level 100 → A1), at base cost with no tech discount. Skills aim for
 * Legendary (A1 level 24, 2% chance), Pets for Legendary (A1 level 37, 7.2%; Epic at level 15 is the
 * cheap option), Mounts for Epic (A1 level 31, 7.2%). The higher rarities are the guide's chart values.
 */
export const ASCENSION_GUIDE: Record<SpendResource, { recommended: GuideRarity; tiers: { rarity: GuideRarity; base: number }[] }> = {
  skills: { recommended: "Legendary", tiers: [{ rarity: "Legendary", base: 49_600 }, { rarity: "Ultimate", base: 142_000 }, { rarity: "Mythic", base: 269_600 }] },
  pets: { recommended: "Legendary", tiers: [{ rarity: "Epic", base: 7_100 }, { rarity: "Legendary", base: 48_600 }, { rarity: "Ultimate", base: 90_000 }, { rarity: "Mythic", base: 147_500 }] },
  mounts: { recommended: "Epic", tiers: [{ rarity: "Epic", base: 30_000 }, { rarity: "Legendary", base: 46_000 }, { rarity: "Ultimate", base: 63_000 }, { rarity: "Mythic", base: 79_000 }] },
};
/** A pillar can be ascended at summon level 100. */
export const ASCEND_LEVEL = 100;
/** Base costs the guide's numbers assume: 5 skills for 200 tickets, 50 clock winders (mount keys) a mount. */
const BASE_FIVE_SKILLS = 200;
const BASE_MOUNT = 50;

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * How much of the base amount this member needs: their own skill or mount cost against the base
 * cost, divided by their extra chance (the guide: 25% discount and 50% extra drop = half).
 */
export function guideFactor(resource: SpendResource, entry: ResourceEntry): number {
  if (resource === "skills") {
    const cost = positive(entry.summoningCosts?.fiveSkills);
    return cost ? Math.min(cost, BASE_FIVE_SKILLS) / BASE_FIVE_SKILLS : 1;
  }
  const extra = positive(resource === "pets" ? entry.planningDetails?.extraPetSummonPercent : entry.planningDetails?.extraMountChancePercent);
  const cost = resource === "mounts" ? positive(entry.summoningCosts?.mount) : 0;
  const discount = cost ? Math.min(cost, BASE_MOUNT) / BASE_MOUNT : 1;
  return discount / (1 + extra / 100);
}

/** The guide's amounts for this member, rarest last. */
export function guideTargets(resource: SpendResource, entry: ResourceEntry): { rarity: GuideRarity; need: number }[] {
  const factor = guideFactor(resource, entry);
  return ASCENSION_GUIDE[resource].tiers.map(({ rarity, base }) => ({ rarity, need: Math.round(base * factor) }));
}

/** Ready to ascend, how much is missing, or which summon level to reach first. */
export function ascendCheck(resource: SpendResource, entry: ResourceEntry | undefined): AscendCheck {
  if (!entry) return { state: "none" };
  const info = SPEND_INFO[resource];
  const level = positive(entry.planningDetails?.[info.level]);
  // 0 means the level was never saved: judge by the resources alone.
  if (level && level < ASCEND_LEVEL) return { state: "level", level: Math.floor(level) };
  const have = positive(entry.resources[info.currency]);
  const targets = guideTargets(resource, entry);
  const reached = targets.filter((target) => have >= target.need);
  const reaches = reached.length ? reached[reached.length - 1].rarity : null;
  const need = targets.find((target) => target.rarity === ASCENSION_GUIDE[resource].recommended)!.need;
  return have >= need
    ? { state: "ready", have, need, reaches: reaches! }
    : { state: "short", have, need, missing: need - have, reaches };
}

/** War points a member's saved resources for this pillar can score (0 when it can't be worked out). */
export function pillarPoints(resource: SpendResource, entry: ResourceEntry, rates: WarRates): number {
  try {
    const estimate = estimateWar([entry], rates, [...SPEND_INFO[resource].activities]);
    return Math.round((estimate.minimum + estimate.maximum) / 2);
  } catch {
    return 0;
  }
}

export interface OrderInput {
  resource: SpendResource;
  /** Active members. */
  members: Member[];
  /** Live banks. */
  entries: ResourceEntry[];
  rates: WarRates;
  /** Who is planning to ascend what this week. */
  ascending: ReadonlyMap<string, readonly AscensionPillar[]>;
  /** In that day's snipe: they go first. */
  snipers: ReadonlySet<string>;
  /** YYYY-MM-DD (UTC): members on holiday until at least this date are skipped. */
  date: string;
  day: number | null;
  today: boolean;
}

/** One pillar's order: snipers first, then the biggest stockpile; members away are listed last, without a place. */
export function buildOrder(input: OrderInput): SpendOrder {
  const { resource } = input;
  const info = SPEND_INFO[resource];
  const entries = new Map(input.entries.map((entry) => [entry.memberId, entry]));
  const rows: SpendRow[] = [];
  for (const member of input.members) {
    const entry = entries.get(member.id);
    if (!entry) continue;
    const amounts = info.amounts.map((key) => ({ key, value: positive(entry.resources[key]) }));
    const points = pillarPoints(resource, entry, input.rates);
    // Nothing saved for this pillar: nothing to line up for.
    if (points <= 0 && amounts.every((amount) => amount.value <= 0)) continue;
    rows.push({
      member,
      place: null,
      points,
      amounts,
      state: member.holidayUntil && member.holidayUntil >= input.date ? "away" : "line",
      sniper: input.snipers.has(member.id),
      ascending: !!input.ascending.get(member.id)?.includes(info.pillar),
      check: ascendCheck(resource, entry),
    });
  }
  const amount = (row: SpendRow) => row.amounts[0]?.value ?? 0;
  // Members away last; then that day's snipers; then members ascending this pillar this week
  // (or, at Ascension 3, pushing the new tiers); then the biggest stockpile.
  rows.sort((a, b) => Number(a.state === "away") - Number(b.state === "away") || Number(b.sniper) - Number(a.sniper)
    || Number(b.ascending) - Number(a.ascending)
    || b.points - a.points || amount(b) - amount(a)
    || a.member.username.localeCompare(b.member.username, undefined, { sensitivity: "base", numeric: true }));
  rows.filter((row) => row.state === "line").forEach((row, index) => { row.place = index + 1; });
  return { resource, day: input.day, today: input.today, rows };
}
