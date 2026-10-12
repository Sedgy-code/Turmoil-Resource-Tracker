import assert from "node:assert/strict";
import { test } from "node:test";
import { CHANCE_PLANNING_DETAILS, EMPTY_PLANNING_DETAILS, EMPTY_RESOURCES, type ResourceValues } from "../src/lib/resources";
import { entryPlanningIssues, filterPlanningIssues, memberPlanningIssues } from "../src/lib/planning-completeness";
import type { Member, ResourceEntry, WarActivity } from "../src/lib/types";
import { DEFAULT_WAR_RATES, estimateWar } from "../src/lib/war";

function bank(memberId: string, resources: Partial<ResourceValues> = {}): ResourceEntry {
  return {
    id: `bank-${memberId}`, memberId, week: "2026-10-12",
    resources: { ...EMPTY_RESOURCES, ...resources },
    summoningCosts: { fiveSkills: 150, mount: 40 },
    planningDetails: { ...CHANCE_PLANNING_DETAILS },
    notes: "", updatedAt: "2026-10-12T01:00:00.000Z",
    updatedBy: { id: "admin", username: "Editing admin" },
  };
}
function member(id: string, username: string): Member {
  return { id, username, discordId: id, avatarUrl: null, role: "MEMBER", active: true, lastUpdatedAt: null, joinedAt: "2026-10-12T00:00:00.000Z" };
}

test("saved positive inventories identify every missing cost and bonus chance by member", () => {
  const entry = bank("member", { skillTickets: 1000, mountKeys: 100, eggshellsTotal: 100 });
  entry.summoningCosts = { fiveSkills: 0, mount: 0 };
  entry.planningDetails = { ...EMPTY_PLANNING_DETAILS };
  assert.deepEqual(entryPlanningIssues(entry).map((issue) => issue.key), ["fiveSkills", "mount", "extraMountChancePercent", "extraPetSummonPercent"]);
  const affected = memberPlanningIssues({ entries: [entry], members: [member("member", "Bank owner")], live: true });
  assert.equal(affected.length, 1);
  assert.equal(affected[0].username, "Bank owner");
  assert.deepEqual(affected[0].issues.map((issue) => issue.label), ["Cost for 5 skills", "Mount summon cost", "Extra mount chance %", "Extra pet summon %"]);
});

test("zero inventories and explicit zero chances never produce misleading estimate warnings", () => {
  const empty = bank("empty");
  empty.summoningCosts = { fiveSkills: 0, mount: 0 };
  empty.planningDetails = { ...EMPTY_PLANNING_DETAILS };
  assert.deepEqual(entryPlanningIssues(empty), []);
  const noBonus = bank("zero-chance", { mountKeys: 1000, eggshellsTotal: 1000 });
  assert.deepEqual(entryPlanningIssues(noBonus), []);
  noBonus.planningDetails = { ...CHANCE_PLANNING_DETAILS, extraMountChancePercent: 12.5, extraPetSummonPercent: 1000 };
  assert.deepEqual(entryPlanningIssues(noBonus), []);
});

test("cost warnings follow the same selected activity criteria as the war calculator", () => {
  const entry = bank("legacy", { skillTickets: 1000, mountKeys: 100 });
  entry.summoningCosts = { fiveSkills: Number.NaN, mount: Number.POSITIVE_INFINITY };
  entry.planningDetails = { ...EMPTY_PLANNING_DETAILS, newMountMerges: 0 };
  const selections: WarActivity[][] = [["hammers"], ["skillSummons"], ["mountSummons"], ["newMountMerges"], ["skillSummons", "mountSummons", "newMountMerges"]];
  for (const activities of selections) {
    const costs = entryPlanningIssues(entry, "historical", activities).filter((issue) => issue.key === "fiveSkills" || issue.key === "mount");
    assert.equal(costs.length, estimateWar([entry], DEFAULT_WAR_RATES, activities, "historical").missingCosts);
  }
  entry.planningDetails.newMountMerges = 1;
  assert.deepEqual(entryPlanningIssues(entry, "historical", ["newMountMerges"]).map((issue) => issue.key), ["mount"]);
  entry.planningDetails = { ...CHANCE_PLANNING_DETAILS, extraMountChancePercent: 0 };
  assert.deepEqual(entryPlanningIssues(entry, "current", ["newMountMerges"]), []);
  entry.planningDetails.extraMountChancePercent = 20;
  assert.deepEqual(entryPlanningIssues(entry, "current", ["newMountMerges"]).map((issue) => issue.key), ["mount"]);
});

test("legacy historical manual actions do not require unrelated modern chance fields", () => {
  const old = bank("legacy", { mountKeys: 1000, eggshellsTotal: 1000 });
  old.planningDetails = { ...EMPTY_PLANNING_DETAILS, newMountMerges: 2, eggMerges: 4, eggSummonMerges: 6 };
  assert.deepEqual(entryPlanningIssues(old, "historical"), []);
  assert.deepEqual(entryPlanningIssues(old, "current").map((issue) => issue.key), ["extraMountChancePercent", "extraPetSummonPercent"]);
});

test("historical modern and mixed banks only flag missing chances on the applicable members", () => {
  const old = bank("legacy", { mountKeys: 1000, eggshellsTotal: 1000 });
  old.planningDetails = { ...EMPTY_PLANNING_DETAILS };
  const modern = bank("modern", { mountKeys: 1000, eggshellsTotal: 1000 });
  modern.planningDetails = { ...EMPTY_PLANNING_DETAILS, calculationVersion: 2, extraMountChancePercent: 0 };
  const modernWithoutMarker = bank("without-marker", { mountKeys: 1000, eggshellsTotal: 1000 });
  modernWithoutMarker.planningDetails = { ...EMPTY_PLANNING_DETAILS, extraPetSummonPercent: 0 };
  const affected = memberPlanningIssues({ entries: [old, modern, modernWithoutMarker], members: [member("legacy", "Old"), member("modern", "Modern"), member("without-marker", "Partial")], live: false });
  assert.deepEqual(affected.map((row) => [row.username, row.issues.map((issue) => issue.key)]), [
    ["Modern", ["extraPetSummonPercent"]], ["Partial", ["extraMountChancePercent"]],
  ]);
});

test("card filtering preserves affected member names and excludes empty banks and unsaved members", () => {
  const skill = bank("skill", { skillTickets: 1000 });
  skill.summoningCosts.fiveSkills = 0;
  const mount = bank("mount", { mountKeys: 1000 });
  mount.summoningCosts.mount = 0;
  mount.planningDetails = { ...EMPTY_PLANNING_DETAILS };
  const complete = bank("complete");
  const affected = memberPlanningIssues({ entries: [mount, skill, complete], members: [member("skill", "Alpha"), member("mount", "Beta"), member("complete", "Complete"), member("no-bank", "Unsaved")], live: true });
  assert.deepEqual(affected.map((row) => row.username), ["Alpha", "Beta"]);
  assert.deepEqual(filterPlanningIssues(affected, ["fiveSkills"]).map((row) => [row.username, row.issues.length]), [["Alpha", 1]]);
  assert.deepEqual(filterPlanningIssues(affected, ["mount", "extraMountChancePercent"]).map((row) => [row.username, row.issues.length]), [["Beta", 2]]);
  assert.deepEqual(filterPlanningIssues(affected, ["extraPetSummonPercent"]), []);
});

test("invalid chances are missing information only when the matching scoring activity is selected", () => {
  const entry = bank("invalid", { mountKeys: 1000, eggshellsTotal: 1000 });
  entry.planningDetails = { ...CHANCE_PLANNING_DETAILS, extraMountChancePercent: Number.NaN, extraPetSummonPercent: -1 };
  assert.deepEqual(entryPlanningIssues(entry, "current", ["mountSummons"]), []);
  assert.deepEqual(entryPlanningIssues(entry, "current", ["newMountMerges"]).map((issue) => issue.key), ["extraMountChancePercent"]);
  assert.deepEqual(entryPlanningIssues(entry, "current", ["eggSummonMerges"]).map((issue) => issue.key), ["extraPetSummonPercent"]);
});
