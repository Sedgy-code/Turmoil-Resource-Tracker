import type { ResourceValues, SummoningCosts, PlanningDetails } from "./resources";

export type MemberRole = "ADMIN" | "MEMBER";

export interface Member {
  id: string;
  discordId: string;
  /** Turmoil server nickname, Discord display name, or account username. */
  username: string;
  avatarUrl: string | null;
  role: MemberRole;
  active: boolean;
  lastUpdatedAt: string | null;
  joinedAt: string;
  badge?: string | null;
  cosmetics?: EquippedCosmetics;
  /** In the clan on Discord but has never signed in to the Clan Hub. */
  neverSignedIn?: boolean;
}

export interface ResourceEntry {
  id: string;
  memberId: string;
  week: string;
  resources: ResourceValues;
  summoningCosts: SummoningCosts;
  planningDetails?: PlanningDetails;
  notes: string;
  updatedAt: string;
  updatedBy: { id: string; username: string };
}

export interface SessionResponse {
  user: Member | null;
  demo: boolean;
  configured: boolean;
  error?: string;
  /** Public address of the tracker; the browser moves there if opened elsewhere. */
  canonicalOrigin?: string;
}

export interface DashboardResponse {
  week: string;
  currentUser: Member;
  members: Member[];
  entries: ResourceEntry[];
  totals: ResourceValues;
  summons: {
    skills: number;
    mounts: number;
    missingSkillCosts: number;
    missingMountCosts: number;
  };
  stats: {
    totalMembers: number;
    submittedMembers: number;
    pendingMembers: number;
    lastUpdatedAt: string | null;
  };
  weeks: string[];
  live?: boolean;
  snapshot?: { capturedAt: string; automatic: boolean } | null;
}

export type WarActivity = "hammers" | "skillSummons" | "mountSummons" | "newMountMerges" | "mountMerges" | "eggMerges" | "eggSummonMerges";
export interface WarRates {
  hammersMin: number;
  hammersMax: number;
  skillSummons: number;
  mountSummons: number;
  newMountMerges: number;
  mountMerges: number;
  eggMerges: number;
  eggSummonMerges: number;
}
export interface ClanSettings { capacity: number; warRates: WarRates }
export interface BankHistorySnapshot {
  id?: string;
  week: string;
  capturedAt: string;
  automatic: boolean;
  members: Member[];
  entries: ResourceEntry[];
  totals: ResourceValues;
}
export interface BankHistoryResponse { snapshots: BankHistorySnapshot[]; current: DashboardResponse }
export interface WarEstimate {
  minimum: number;
  maximum: number;
  rows: { activity: WarActivity; label: string; quantity: number; minimum: number; maximum: number }[];
  missingCosts: number;
}
export interface SnipePlan {
  id: string;
  title: string;
  startsAt: string;
  activities: WarActivity[];
  archived: boolean;
  createdBy: string;
  createdAt: string;
  responses: { memberId: string; answer: "yes" | "no"; updatedAt: string }[];
  attendees?: { memberId: string; confirmedBy: string; confirmedAt: string; member?: Member }[];
  participants: { member: Member; estimate: WarEstimate }[];
  counts: { yes: number; no: number; unanswered: number };
  estimate: WarEstimate;
}
export interface SnipesResponse { plans: SnipePlan[] }
export type CosmeticCategory = "badge" | "title" | "accent" | "frame";
export type EquippedCosmetics = Record<CosmeticCategory, string | null>;
export interface DewItem {
  id: string;
  name: string;
  symbol: string;
  cost: number;
  category: CosmeticCategory;
  /** Visual treatment for accents and frames; always selected from the catalog. */
  style?: string;
  legacy?: boolean;
}
export interface DewResponse {
  balance: number;
  earnedToday: boolean;
  resourceRewardEarned: boolean;
  snipeRewardEarned: boolean;
  rewardWeek: string;
  equipped: string | null;
  equippedCosmetics: EquippedCosmetics;
  owned: string[];
  items: DewItem[];
}

export interface WeeksResponse {
  weeks: string[];
  currentWeek: string;
}
export interface MembersResponse {
  members: Member[];
}
export interface EntryResponse {
  entry: ResourceEntry;
}
export interface ApiErrorResponse {
  error: string;
  code?: string;
}

export type HoardingReason = "large" | "growing" | "skipsSnipes" | "stale" | "noWarSpending" | "spendsInWars";
export type HoardingLevel = "high" | "watch" | "saver" | "ok";
/** When does saving count as hoarding? Set by admins on the Hoarding Watch page. */
export interface HoardingRules { largeMultiple: number; spendPercent: number; wars: number }
export interface HoardingRow {
  member: Member;
  /** Estimated war points of everything the member holds. */
  warValue: number;
  /** How many times the clan's typical (median) member this is. */
  timesTypical: number | null;
  /** Change in war value over the last four weeks; null without enough history. */
  change: number | null;
  trackedWeeks: number;
  /** Saves in the last eight weeks where their holdings dropped (resources spent). */
  spendsRecently: number;
  lastSpendAt: string | null;
  snipes: { held: number; saidYes: number; attended: number };
  lastSavedAt: string | null;
  /** Share of their holdings used during the last few wars (%); null without war data. */
  warUsePercent: number | null;
  reasons: HoardingReason[];
  level: HoardingLevel;
  note: string;
  noteUpdatedAt: string | null;
  noteBy: string | null;
}
export interface HoardingResponse { typicalWarValue: number; rows: HoardingRow[]; rules: HoardingRules; measuredWars: number; generatedAt: string }

export interface WarResultPoint { position: number; gameName: string; memberId: string | null; points: number }
export interface WarResult {
  id: string;
  week: string;
  label: string;
  clanTotal: number | null;
  createdAt: string;
  createdBy: string;
  points: WarResultPoint[];
  imageIds: string[];
}
export interface WarResultsResponse { results: WarResult[] }
/** What the screenshot reader found, before an admin checks and saves it. */
export interface WarReading {
  clanTotal: number | null;
  rows: { gameName: string; points: number; memberId: string | null }[];
}
export interface SnipeRecognition {
  /** Confirmed snipes per member in the last eight weeks. */
  recent: Record<string, number>;
  /** Confirmed snipes per member, all time. */
  total: Record<string, number>;
  /** Members confirmed at a snipe in the previous clan week. */
  lastWeek: string[];
}
export interface RecognitionResponse {
  snipes: SnipeRecognition;
  /** Latest war's points per member. */
  latestWar: { id: string; week: string; label: string; clanTotal: number | null; points: Record<string, number> } | null;
}
export interface WarSpendingRow {
  member: Member;
  /** Holdings (estimated war points) before the war week; null if they never saved before it. */
  before: number | null;
  /** Holdings at their first-available save after the war started; null if not updated since. */
  after: number | null;
  /** before − after: positive means resources were spent, negative means they grew. */
  spent: number | null;
  warPoints: number | null;
  savedAfterAt: string | null;
}
export interface WarSpendingResponse { week: string; warWeeks: string[]; rows: WarSpendingRow[] }

export type RankingMetric = "warPoints" | "vials" | "snipes" | "updates" | "warSpending";
export interface ContributionRow {
  member: Member;
  rank: number;
  /** 0–100; lower means contributing less. */
  score: number;
  /** Average war points over the last few wars (0 when missing from a war). */
  warPoints: number | null;
  warsPlayed: number;
  /** Vials donated across the last few vial records. */
  vials: number | null;
  snipes: number;
  /** Said Yes to a snipe but wasn't ticked as attending. */
  noShows: number;
  /** Weeks with a complete resource save, out of the last 8. */
  updates: number;
  /** Holdings used during recent war weeks (estimated war points). */
  warSpending: number | null;
  hoarding: HoardingLevel;
  penalty: number;
  parts: Partial<Record<RankingMetric, number>>;
  daysInClan: number;
  isNew: boolean;
  lastSavedAt: string | null;
}
export interface ContributionRankingResponse {
  rows: ContributionRow[];
  weights: Partial<Record<RankingMetric, number>>;
  records: { wars: number; vials: number };
  generatedAt: string;
}
