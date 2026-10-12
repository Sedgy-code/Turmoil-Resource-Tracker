import type { DashboardResponse, Member, ResourceEntry, WarActivity } from "./types";

export type PlanningIssueKey = "fiveSkills" | "mount" | "extraMountChancePercent" | "extraPetSummonPercent";
export interface PlanningIssue { key: PlanningIssueKey; label: string }
export interface MemberPlanningIssues {
  memberId: string;
  username: string;
  issues: PlanningIssue[];
}

const ALL_ACTIVITIES: WarActivity[] = ["hammers", "skillSummons", "mountSummons", "newMountMerges", "mountMerges", "eggMerges", "eggSummonMerges"];
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const recordedChance = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1000;

/** Only report missing information that affects the selected estimate's inventory. */
export function entryPlanningIssues(
  entry: ResourceEntry,
  mode: "current" | "historical" = "current",
  activities: readonly WarActivity[] = ALL_ACTIVITIES,
): PlanningIssue[] {
  const selected = new Set(activities);
  const details = entry.planningDetails;
  // Old snapshots retain manual action counts; modern snapshots retain chances.
  const usesChance = mode === "current" || details?.calculationVersion === 2 ||
    details?.extraMountChancePercent !== undefined || details?.extraPetSummonPercent !== undefined;
  const issues: PlanningIssue[] = [];
  if (selected.has("skillSummons") && positive(entry.resources.skillTickets) && !positive(entry.summoningCosts?.fiveSkills)) {
    issues.push({ key: "fiveSkills", label: "Cost for 5 skills" });
  }
  if (positive(entry.resources.mountKeys)) {
    const plansBonus = usesChance ? positive(details?.extraMountChancePercent) : positive(details?.newMountMerges);
    if ((selected.has("mountSummons") || (selected.has("newMountMerges") && plansBonus)) && !positive(entry.summoningCosts?.mount)) {
      issues.push({ key: "mount", label: "Mount summon cost" });
    }
    if (usesChance && selected.has("newMountMerges") && !recordedChance(details?.extraMountChancePercent)) {
      issues.push({ key: "extraMountChancePercent", label: "Extra mount chance %" });
    }
  }
  if (usesChance && selected.has("eggSummonMerges") && positive(entry.resources.eggshellsTotal) && !recordedChance(details?.extraPetSummonPercent)) {
    issues.push({ key: "extraPetSummonPercent", label: "Extra pet summon %" });
  }
  return issues;
}

/** Missing banks are separate from incomplete estimates of saved inventories. */
export function memberPlanningIssues(
  data: Pick<DashboardResponse, "entries" | "members" | "live">,
  activities: readonly WarActivity[] = ALL_ACTIVITIES,
): MemberPlanningIssues[] {
  const members = new Map<string, Member>(data.members.map((member) => [member.id, member]));
  return data.entries.flatMap((entry) => {
    const issues = entryPlanningIssues(entry, data.live === false ? "historical" : "current", activities);
    if (!issues.length) return [];
    return [{ memberId: entry.memberId, username: members.get(entry.memberId)?.username ?? entry.updatedBy.username, issues }];
  }).sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base", numeric: true }));
}

export function filterPlanningIssues(members: MemberPlanningIssues[], keys: readonly PlanningIssueKey[]): MemberPlanningIssues[] {
  return members.flatMap((member) => {
    const issues = member.issues.filter((issue) => keys.includes(issue.key));
    return issues.length ? [{ ...member, issues }] : [];
  });
}
