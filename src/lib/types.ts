import type { ResourceValues } from "./resources";

export type MemberRole = "ADMIN" | "MEMBER";

export interface Member {
  id: string;
  discordId: string;
  username: string;
  avatarUrl: string | null;
  role: MemberRole;
  active: boolean;
  lastUpdatedAt: string | null;
  joinedAt: string;
}

export interface ResourceEntry {
  id: string;
  memberId: string;
  week: string;
  resources: ResourceValues;
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
  stats: {
    totalMembers: number;
    submittedMembers: number;
    pendingMembers: number;
    lastUpdatedAt: string | null;
  };
  weeks: string[];
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
