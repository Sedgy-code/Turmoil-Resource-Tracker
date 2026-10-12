import {
  RESOURCE_FIELDS,
  resourceMaximum,
  MOUNT_SUMMON_COST_MIN,
  MOUNT_SUMMON_COST_MAX,
  SKILL_SUMMON_COST_MIN,
  SKILL_SUMMON_COST_MAX,
  skillCostHasValidPrecision,
  type PlanningDetails,
  type ResourceValues,
  type SummoningCosts,
} from "./resources";

type BankInformation = {
  resources?: Partial<ResourceValues>;
  summoningCosts?: Partial<SummoningCosts>;
  planningDetails?: Partial<PlanningDetails>;
};

/** Zero is recorded information; absent, nonfinite, or invalid values are not. */
export function assessBankCompleteness(input: BankInformation): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const { key, label } of RESOURCE_FIELDS) {
    const value = input.resources?.[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > resourceMaximum(key)) missing.push(label);
  }
  const skills = input.summoningCosts?.fiveSkills;
  if (typeof skills !== "number" || !Number.isFinite(skills) || skills < SKILL_SUMMON_COST_MIN || skills > SKILL_SUMMON_COST_MAX || !skillCostHasValidPrecision(skills)) {
    missing.push("Cost for 5 skills");
  }
  const mount = input.summoningCosts?.mount;
  if (typeof mount !== "number" || !Number.isFinite(mount) || mount < MOUNT_SUMMON_COST_MIN || mount > MOUNT_SUMMON_COST_MAX) missing.push("Mount summon cost");
  for (const [key, label] of [["skillLevel", "Skill level"], ["mountLevel", "Mount level"], ["eggLevel", "Egg/pet level"]] as const) {
    const value = input.planningDetails?.[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) missing.push(label);
  }
  for (const [key, label] of [["extraMountChancePercent", "Extra mount chance %"], ["extraPetSummonPercent", "Extra pet summon %"]] as const) {
    const value = input.planningDetails?.[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) missing.push(label);
  }
  return { complete: missing.length === 0, missing };
}
