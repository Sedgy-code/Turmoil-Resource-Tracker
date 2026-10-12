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
  participants: { member: Member; estimate: WarEstimate }[];
  counts: { yes: number; no: number; unanswered: number };
  estimate: WarEstimate;
}
export interface SnipesResponse { plans: SnipePlan[] }
export interface DewItem { id: string; name: string; symbol: string; cost: number }
export interface DewResponse {
  balance: number;
  earnedToday: boolean;
  equipped: string | null;
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
