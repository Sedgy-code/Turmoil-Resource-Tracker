import type { ResourceKey, ResourceValues, SummoningCosts, PlanningDetails } from "./resources";

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
  /** When they first joined the Clan Hub. */
  joinedAt: string;
  /** When they joined the Turmoil Discord server (Discord's date), once known: "in the clan since". */
  discordJoinedAt?: string;
  badge?: string | null;
  cosmetics?: EquippedCosmetics;
  /** In the clan on Discord but has never signed in to the Clan Hub. */
  neverSignedIn?: boolean;
  /** Away until this date (YYYY-MM-DD, inclusive); shown to everyone. */
  holidayUntil?: string | null;
  /** Active strikes. Only included for admins. */
  strikes?: number;
  /** Allowed a Discord message when they haven't saved (a leader's nudge, once a week). */
  remindersAllowed?: boolean;
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
  /** Upcoming snipes the member hasn't answered yet (shown on the Snipes tab). */
  snipesToAnswer?: number;
  /** Snipes still to come or on now: the Snipes tab glows while there are any. */
  snipesOpen?: number;
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
/**
 * The clan's war point bonuses in percent, from its Clan Tech levels: by activity ("War Points From …")
 * and by war day ("War Points On Day …"). The rates above are with personal tech; this comes on top.
 */
export interface WarTech { activity: Partial<Record<WarActivity, number>>; day: Partial<Record<number, number>> }
export interface ClanSettings { capacity: number; warRates: WarRates; warTech?: WarTech }
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
/** Maybe: might join. Not counted as coming, and missing the snipe isn't held against them. */
export type SnipeAnswer = "yes" | "maybe" | "no";
export interface SnipePlan {
  id: string;
  title: string;
  startsAt: string;
  activities: WarActivity[];
  archived: boolean;
  createdBy: string;
  createdAt: string;
  /** The last time a leader called the snipers in #snipe-chat (count = members pinged). */
  assembled?: { by: string; at: string; count: number } | null;
  /** A leader called the snipe off; it's archived and closed to answers and check-in. */
  cancelled?: { by: string; at: string } | null;
  responses: { memberId: string; answer: SnipeAnswer; updatedAt: string }[];
  attendees?: { memberId: string; confirmedBy: string; confirmedAt: string; member?: Member }[];
  participants: { member: Member; estimate: WarEstimate }[];
  /** maybe is missing from snipes archived before Maybe existed. */
  counts: { yes: number; maybe?: number; no: number; unanswered: number };
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
  /** Voted for the next war's clan days (10 Clan Points, once per war). */
  voteRewardEarned: boolean;
  /** Weeks in a row with a complete save (time away doesn't break it). */
  streak?: { weeks: number; best: number };
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
  /** What the Discord check just changed, when it ran and changed something (names). */
  discord?: { added: string[]; removed: string[]; restored: string[] };
}
export interface MemberHistoryEvent {
  at: string;
  kind: "joined" | "left" | "returned" | "role" | "strike" | "strike-removed" | "holiday" | "holiday-ended" | "war" | "vials" | "snipe" | "saved";
  text: string;
  /** The English sentence with {placeholders}, so the panel can show it in the reader's language. */
  template?: string;
  values?: Record<string, string>;
  by?: string | null;
  strikeId?: string;
}
export interface MemberHistoryResponse {
  member: Member;
  strikes: { id: string; reason: string; createdAt: string; createdBy: string }[];
  events: MemberHistoryEvent[];
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
  /** Daily war-point uploads only: which war day (1–5) the points are for. */
  warDay: number | null;
}
export interface WarResultsResponse { results: WarResult[] }
/** Members' votes for the days they'd like to fight in the next war. */
export interface ClanDayVotes {
  /** The next war, by the Monday before its Day 1. */
  week: string;
  /** Voting runs on Days 6 and 7 until leadership picks the days. */
  open: boolean;
  /** The days leadership picked for that war (empty until picked). */
  picked: number[];
  /** Votes for Days 1–5 (index 0 = Day 1). */
  counts: number[];
  /** Members who voted for each pair of days, e.g. { "1,3": 8 }. */
  pairs: Record<string, number>;
  /** Members who voted for at least one day. */
  voters: number;
  /** Your vote, or null if you haven't voted. */
  mine: number[] | null;
  /** After voting: whether this vote just earned the 10 Clan Points. */
  rewarded?: boolean;
}
/** The four pillars a member can ascend. */
export type AscensionPillar = "forge" | "skills" | "mounts" | "pets";
export interface AscensionsResponse {
  /** The clan week (Monday to Monday, UTC). */
  week: string;
  /** Your answer this week: null until you answer, [] when you're not ascending. */
  mine: AscensionPillar[] | null;
  /** Members ascending this week and what (members who said No aren't listed). */
  ascending: { memberId: string; pillars: AscensionPillar[] }[];
}
/** The days leadership picked for the clan to spend in one war (Day 6 is always the battle). */
export interface ClanDaysResponse { week: string; days: number[] }
export interface WarDayRow {
  member: Member | null;
  /** In-game name, for players not matched to a clan member. */
  name: string;
  /** War points on Days 1–5 (index 0 = Day 1); null when that day has no upload or the player isn't on it. */
  days: (number | null)[];
  onClanDays: number;
  otherDays: number;
  /** More than offDayLimit of their points came on days that weren't clan days. */
  blackMark: boolean;
}
export interface WarDayReport {
  /** The war (Monday before its Day 1) this report is for. */
  week: string;
  /** Wars with daily uploads, newest first. */
  weeks: string[];
  clanDays: number[];
  uploads: WarResult[];
  rows: WarDayRow[];
  offDayLimit: number;
}
/** What the screenshot reader found, before an admin checks and saves it. */
export interface WarReading {
  clanTotal: number | null;
  /** points is null when the reader could see the name but not the number. */
  rows: { gameName: string; points: number | null; memberId: string | null }[];
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
  /** Last month's awards (stored on the 1st of each month). */
  awards?: MonthlyAwards | null;
}
export type AwardKey = "war" | "vials" | "snipes" | "saver";
export interface MonthlyAwards { month: string; items: { award: AwardKey; memberIds: string[]; value: number }[] }
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

export type RankingMetric = "warPoints" | "vials" | "snipes" | "updates" | "clanDays";
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
  /** Weeks with a complete resource save, out of the last 8. */
  updates: number;
  /** Share (0–1) of their war points scored on the clan's chosen days, over recent wars. */
  clanDayShare: number | null;
  /** Recent wars where too much of their spending was on other days. */
  blackMarks: number;
  penalty: number;
  parts: Partial<Record<RankingMetric, number>>;
  /** Days since they joined the Turmoil Discord server (or the Clan Hub, until Discord's date is known). */
  daysInClan: number;
  isNew: boolean;
  lastSavedAt: string | null;
}
/** Leadership jobs that are due right now, for the to-do card at the top of Home. */
export interface LeaderTodo {
  /** Today's daily war screenshot (Days 1–5) is missing; that day ends at endsAt. */
  warDay: { day: number; endsAt: string } | null;
  /** The clan days aren't picked: this war's (Days 1–5) or the next war's (Days 6–7, with members' votes). */
  clanDays: { nextWar: boolean; voters: number } | null;
  /** Day 7: the end-of-war screenshots are missing (they reset when the next war starts). */
  warResults: { closesAt: string } | null;
  /** Day 6: the vial donation list is missing (the race resets on Monday 00:00 UTC). */
  vials: { closesAt: string } | null;
  /** Snipes that started recently and aren't archived: check who came. */
  attendance: { id: string; title: string; startsAt: string; checkedIn: number; saidYes: number }[];
  /** Active members (not away) without a complete save this clan week. */
  unsaved: number;
  /** Members away right now. */
  away: number;
}

export type MemberWeekState = "saved" | "notStarted" | "away";
/** One member's week on the leaders' status board. */
export interface StatusRow {
  member: Member;
  state: MemberWeekState;
  /** When they last saved their resources (any week). */
  savedAt: string | null;
  /** Their vote for next war's clan days, while voting is open (null: not voted). */
  vote: number[] | null;
  /** Their answer to the next snipe (null: not answered, or no snipe). */
  snipe: SnipeAnswer | null;
  remindersAllowed: boolean;
  /** A leader's reminder this clan week (one per member per week). */
  nudge: { by: string; at: string } | null;
}
export interface StatusResponse {
  /** The clan week (Monday 00:00 UTC). */
  week: string;
  /** Voting for next war's clan days is open (Days 6–7). */
  voting: boolean;
  /** The next snipe, whose answers are shown. */
  snipe: { id: string; title: string; startsAt: string; activities: WarActivity[] } | null;
  rows: StatusRow[];
  /** The last time a leader reminded everyone who hadn't saved (at most every 12 hours). */
  lastReminder: { by: string; at: string; count: number } | null;
}

export interface ContributionRankingResponse {
  rows: ContributionRow[];
  weights: Partial<Record<RankingMetric, number>>;
  records: { wars: number; vials: number };
  generatedAt: string;
}


/** What the spending order lines up: the three pillars whose resources score on clan days (hammers have no line). */
export type SpendResource = "skills" | "pets" | "mounts";
export type GuideRarity = "Epic" | "Legendary" | "Ultimate" | "Mythic";
/**
 * Whether a member has saved enough to ascend a pillar, by the official Forge Master Discord guide
 * (a first ascension), worked out with the member's own discount and extra chance.
 */
export type AscendCheck =
  | { state: "ready"; have: number; need: number; reaches: GuideRarity }
  | { state: "short"; have: number; need: number; missing: number; reaches: GuideRarity | null }
  | { state: "level"; level: number }
  | { state: "none" };
export interface SpendRow {
  member: Member;
  /** Place in the order (1 = first); members away on holiday have none. */
  place: number | null;
  /** War points the member's saved resources for this pillar can score (what the order is by). */
  points: number;
  /** The saved amounts behind it, e.g. skill tickets, or eggs/pets and eggshells. */
  amounts: { key: ResourceKey; value: number }[];
  /** In the order, or skipped because they're away. */
  state: "line" | "away";
  /** Said Yes to (or checked in for) that day's snipe: they go first. */
  sniper: boolean;
  /** Planning to ascend this pillar this week (Home). */
  ascending: boolean;
  check: AscendCheck;
  /** A leader approved them to spend early (they can't make that day's snipe). */
  early?: boolean;
}
export interface SpendOrder {
  resource: SpendResource;
  /** The clan day this order is for (today, or the next one where this resource scores); null when there isn't one. */
  day: number | null;
  /** That clan day is today. */
  today: boolean;
  rows: SpendRow[];
  /** That day's snipe for this line (ISO), if one is planned: members who can't make it may ask to spend early. */
  snipeAt?: string | null;
}
export interface SpendingOrderResponse {
  /** The war it's for, by the Monday before its Day 1. */
  week: string;
  /** Today's war day (1–7). */
  warDay: number;
  /** Days 6 and 7: the war's spending is over, so the order is for the next war. */
  nextWar: boolean;
  clanDays: number[];
  orders: SpendOrder[];
  /** Requests to spend early (before a snipe the member can't make) for this war. */
  early: EarlySpendRequest[];
  /** Leaders only: the Discord forum post, and whether early spend requests show in Discord. */
  post?: { enabled: boolean; configured: boolean; openDays: number[]; earlyDiscord: boolean };
}
export type EarlySpendStatus = "pending" | "approved" | "declined" | "cancelled";
/**
 * A member's time zone, from their Discord role in #⏲️-pick-your-timezone, e.g. "Reset 8–9am · UTC+8 to +9":
 * the UTC offsets (hours) it covers.
 */
export interface ResetZone { name: string; from: number; to: number }
/** A member who can't make a clan day's snipe asks to spend that line early; any leader approves or declines. */
export interface EarlySpendRequest {
  id: string;
  /** The war, by the Monday before its Day 1. */
  week: string;
  day: number;
  resource: SpendResource;
  member: Member;
  status: EarlySpendStatus;
  /** When they plan to spend (ISO); null means any time before the snipe. */
  spendAt: string | null;
  /** Why they can't make the snipe (needed unless the snipe is in their night). */
  reason: string;
  /** Their place in the line and its war points when they asked. */
  place: number | null;
  points: number;
  zone: ResetZone | null;
  /** The snipe they can't make (ISO). */
  snipeAt: string;
  /** The snipe falls between 11 pm and 7 am for them. */
  night: boolean;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}
/** Before the Hub's form opens: whether this member can ask for this line, and if a reason is needed. */
export interface EarlySpendCheck {
  canAsk: boolean;
  /** Why not, in English (the interface translates it), with its {placeholders}. */
  blocked?: string;
  values?: Record<string, string | number>;
  /** They have no time zone role in Discord yet: where to pick one. */
  needsZone?: boolean;
  zoneUrl?: string;
  zone: ResetZone | null;
  snipeAt: string | null;
  /** The snipe's time for them, e.g. "07:30–08:30". */
  localTime: string | null;
  night: boolean;
  reasonRequired: boolean;
}
/** The #spending-order post's embed (a Discord card), drawn the same way in the leaders' preview. */
export interface SpendingPostEmbed {
  color: number;
  author: { name: string; iconUrl: string; url: string };
  title: string;
  url: string;
  description: string;
  /** A field with the name "\u200b" carries on the list above it. */
  fields: { name: string; value: string }[];
  footer: string;
  button: { label: string; url: string };
  /** Early spend requests switched on: a button that asks the bot (members who can't make the snipe). */
  ask?: { label: string; customId: string };
}
export interface SpendingPostPreview {
  /** The clan day the post is for: the next one due (tomorrow's, or today's), else the next clan day. */
  day: number | null;
  /** It can go up now: posts go up the day before their clan day. */
  due: boolean;
  /** The forum post's title. */
  title: string;
  /** The line above the embed. */
  content: string;
  embed: SpendingPostEmbed | null;
  enabled: boolean;
  /** That day's post is already up in Discord. */
  posted: boolean;
}
