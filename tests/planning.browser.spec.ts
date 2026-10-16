import { existsSync } from "node:fs";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type {
  BankHistoryResponse,
  ClanSettings,
  DashboardResponse,
  DewResponse,
  ResourceEntry,
  SessionResponse,
  SnipesResponse,
  WarActivity,
} from "../src/lib/types";
import { CHANCE_PLANNING_DETAILS, EMPTY_RESOURCES, RESOURCE_FIELDS } from "../src/lib/resources";
import { DEFAULT_WAR_RATES, WAR_ACTIVITIES } from "../src/lib/war";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
test.use({
  baseURL,
  browserName: "chromium",
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  },
  viewport: { width: 1440, height: 1000 },
  actionTimeout: 15_000,
});
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<T>;
}

async function ownBank(request: APIRequestContext) {
  const data = await read<DashboardResponse>(request, "/api/bank");
  const entry = data.entries.find((row) => row.memberId === data.currentUser.id);
  expect(entry, "Demo admin must have a bank fixture").toBeTruthy();
  return { data, entry: entry! };
}

async function saveBank(request: APIRequestContext, entry: ResourceEntry) {
  const response = await request.put("/api/bank", {
    headers: { Origin: baseURL },
    data: {
      memberId: entry.memberId,
      resources: { ...EMPTY_RESOURCES, ...entry.resources },
      summoningCosts: entry.summoningCosts,
      planningDetails: { ...CHANCE_PLANNING_DETAILS, ...entry.planningDetails, extraMountChancePercent: entry.planningDetails?.extraMountChancePercent ?? 0, extraPetSummonPercent: entry.planningDetails?.extraPetSummonPercent ?? 0, calculationVersion: 2 },
      notes: entry.notes,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()).entry as ResourceEntry;
}

async function saveSettings(request: APIRequestContext, settings: ClanSettings) {
  const response = await request.patch("/api/settings", {
    headers: { Origin: baseURL },
    data: settings,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1,
  )).toBeTruthy();
}

async function expectHeaderBalance(page: Page, balance: number) {
  const header = page.locator(".topbar-clan-points");
  const formatted = new Intl.NumberFormat("en-US").format(balance);
  await expect(header).toBeVisible();
  await expect(header).toHaveAttribute("aria-label", `${formatted} Clan Points. Open Reward Shop.`);
  await expect(header).toContainText(formatted);
}

async function noHeaderOverlap(page: Page) {
  const balance = page.locator(".topbar-clan-points");
  const bounds = await balance.boundingBox();
  expect(bounds).toBeTruthy();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
  for (const sibling of await page.locator(".topbar-actions > :not(.topbar-clan-points)").all()) {
    if (!await sibling.isVisible()) continue;
    const other = await sibling.boundingBox();
    if (!other) continue;
    const overlapWidth = Math.min(bounds!.x + bounds!.width, other.x + other.width) - Math.max(bounds!.x, other.x);
    const overlapHeight = Math.min(bounds!.y + bounds!.height, other.y + other.height) - Math.max(bounds!.y, other.y);
    expect(overlapWidth <= 1 || overlapHeight <= 1, "Clan Points must not overlap another top-bar control").toBeTruthy();
  }
}

async function selectActivities(page: Page, selected: WarActivity[]) {
  for (const activity of WAR_ACTIVITIES) {
    await page.getByRole("checkbox", { name: activity.label, exact: true })
      .setChecked(selected.includes(activity.key));
  }
}

test.beforeAll(async ({ request }) => {
  const session = await read<SessionResponse>(request, "/api/session");
  // These workflows exercise real writes and must never run against a live clan.
  test.skip(!session.demo || !session.user,
    "Use DEMO_MODE=true with a dedicated browser-test database.");
  const own = await ownBank(request);
  if (own.entry.planningDetails?.calculationVersion !== 2 || own.entry.planningDetails.extraMountChancePercent === undefined || own.entry.planningDetails.extraPetSummonPercent === undefined) await saveBank(request, own.entry);
  const history = await read<BankHistoryResponse>(request, "/api/history");
  const completed = history.snapshots.find((snapshot) => snapshot.week < history.current.week);
  expect(completed, "Demo seeds a completed legacy week to verify migration").toBeTruthy();
  const legacy = await read<DashboardResponse>(request, `/api/dashboard?week=${completed!.week}`);
  const bankValues = (entries: ResourceEntry[]) => entries.map((entry) => ({
    memberId: entry.memberId, resources: { ...EMPTY_RESOURCES, ...entry.resources }, summoningCosts: entry.summoningCosts,
  })).sort((a, b) => a.memberId.localeCompare(b.memberId));
  // Initial replay must preserve every old weekly submission, including members
  // who did not have a bank at an earlier intermediate replay timestamp.
  expect(bankValues(completed!.entries)).toEqual(bankValues(legacy.entries));
});

test("personal bank, eggshells, levels, costs, and percentage chances survive a page reload", async ({ page, request }) => {
  const { entry } = await ownBank(request);
  try {
    await page.goto("/resources");
    await page.getByLabel("Skill Tickets", { exact: true }).fill("600");
    await page.getByLabel("Mount Keys", { exact: true }).fill("75");
    await page.getByLabel("Hammers", { exact: true }).fill("10");
    await page.getByLabel("Total eggs/pets", { exact: true }).fill("20");
    await page.getByLabel("Eggshells total", { exact: true }).fill("1250");
    await page.getByLabel("Skill summon cost (×5)", { exact: true }).fill("150");
    await page.getByLabel("Mount summon cost (×1)", { exact: true }).fill("37.5");
    for (const [label, value] of [
      ["Skill level", "42"], ["Mount level", "43"], ["Egg/pet level", "44"],
      ["Extra mount chance %", "20.5"], ["Extra pet summon %", "25"],
    ]) await page.getByLabel(label, { exact: true }).fill(value);
    const save = page.getByRole("button", { name: "Save resources", exact: true });
    for (const label of ["Extra mount chance %", "Extra pet summon %"]) {
      const chance = page.getByLabel(label, { exact: true });
      const valid = await chance.inputValue();
      for (const invalid of ["", "-1", "1000.01", "0.001"]) {
        await chance.fill(invalid);
        expect(await chance.evaluate((input: HTMLInputElement) => input.checkValidity())).toBeFalsy();
        await expect(save).toBeDisabled();
      }
      await chance.fill("0");
      await expect(save).toBeEnabled();
      await chance.fill(valid);
    }
    await page.getByLabel("Egg/pet level", { exact: true }).fill("");
    await expect(save).toBeDisabled();
    await page.getByLabel("Egg/pet level", { exact: true }).fill("44");
    await page.getByLabel("Notes", { exact: true }).fill("Persistent bank browser fixture.");
    await page.getByRole("button", { name: "Save resources", exact: true }).click();
    await expect(page.locator(".toast")).toContainText(/saved/i);
    await page.reload();
    await expect(page.getByLabel("Skill Tickets", { exact: true })).toHaveValue("600");
    await expect(page.getByLabel("Mount summon cost (×1)", { exact: true })).toHaveValue("37.5");
    await expect(page.getByLabel("Extra mount chance %", { exact: true })).toHaveValue("20.5");
    await expect(page.getByLabel("Extra pet summon %", { exact: true })).toHaveValue("25");
    await expect(page.getByLabel("Eggshells total", { exact: true })).toHaveValue("1250");
    await expect(page.getByLabel("Newly summoned mount merges", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Existing egg/pet merges", { exact: true })).toHaveCount(0);
    const saved = (await ownBank(request)).entry;
    expect(saved.planningDetails).toMatchObject({
      skillLevel: 42, mountLevel: 43, eggLevel: 44,
      extraMountChancePercent: 20.5, extraPetSummonPercent: 25, calculationVersion: 2,
    });
    expect(saved.resources.eggshellsTotal).toBe(1250);
    expect(saved.summoningCosts).toEqual({ fiveSkills: 150, mount: 37.5 });
    await page.goto("/");
    await expect(page.getByText("Potions", { exact: true })).toHaveCount(0);
    await expect(page.locator(".arsenal-eggsPetsTotal")).toBeVisible();
  } finally {
    await saveBank(request, entry);
  }
});

test("contribution columns reverse their sort and the roster offers freshness ordering", async ({ page, request }) => {
  await page.goto("/");
  const header = page.getByRole("columnheader").filter({
    has: page.getByRole("button", { name: "Skill Tickets", exact: true }),
  });
  const numericValues = async () => {
    const column = await header.evaluate((element) =>
      Array.from(element.parentElement!.children).indexOf(element),
    );
    return page.getByRole("table").locator("tbody tr").evaluateAll((rows, index) =>
      rows.map((row) => Number(row.children[index]?.textContent?.replace(/[^0-9.-]/g, "") || "0")),
    column);
  };
  await header.getByRole("button").click();
  const firstDirection = await header.getAttribute("aria-sort");
  const first = await numericValues();
  expect(first.length).toBeGreaterThan(1);
  expect(first).toEqual([...first].sort((a, b) => firstDirection === "ascending" ? a - b : b - a));
  await header.getByRole("button").click();
  await expect(header).toHaveAttribute("aria-sort", firstDirection === "ascending" ? "descending" : "ascending");
  const second = await numericValues();
  expect(second).toEqual([...first].reverse());
  await page.goto("/members");
  const sort = page.getByLabel("Sort roster", { exact: true });
  for (const label of ["Oldest update first", "Newest update first", "A–Z"]) {
    await sort.selectOption({ label });
    await expect(sort.locator("option:checked")).toHaveText(label);
  }
  await expect(page.getByText(/under 24/i)).toBeVisible();
  await expect(page.getByText(/week.*never|never.*week/i)).toBeVisible();
  const { settings } = await read<{ settings: ClanSettings }>(request, "/api/settings");
  try {
    await page.getByLabel("Member capacity", { exact: true }).fill("99");
    await page.getByRole("button", { name: "Save capacity", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("Clan capacity saved");
    await page.reload();
    await expect(page.getByLabel("Member capacity", { exact: true })).toHaveValue("99");
    expect((await read<{ settings: ClanSettings }>(request, "/api/settings")).settings.capacity).toBe(99);
  } finally {
    await saveSettings(request, settings);
  }
});

test("war estimates derive fractional bonus actions from per-member chances across scopes", async ({ page, request }) => {
  const { entry } = await ownBank(request);
  const { settings } = await read<{ settings: ClanSettings }>(request, "/api/settings");
  try {
    await saveSettings(request, { ...settings, warRates: DEFAULT_WAR_RATES });
    await saveBank(request, {
      ...entry,
      resources: { ...EMPTY_RESOURCES, skillTickets: 600, mountKeys: 75, hammers: 10, mountsToMerge: 4, eggsPetsTotal: 20, eggshellsTotal: 1250 },
      summoningCosts: { fiveSkills: 150, mount: 37.5 },
      planningDetails: { ...CHANCE_PLANNING_DETAILS, extraMountChancePercent: 25, extraPetSummonPercent: 20 },
    });
    await page.goto("/war-points");
    await page.getByRole("button", { name: "My totals", exact: true }).click();
    await selectActivities(page, ["hammers", "mountSummons", "newMountMerges", "eggMerges", "eggSummonMerges"]);
    // 2 mount summons + 0.5 bonus merges, 20 existing eggs/pets + 2.5 extra pet merges.
    // Mount Keys / 37.5 is the summon basis; raw keys must not drive bonus merges.
    await expect(page.locator(".war-estimate-total")).toHaveText("53,345–53,375");
    await expect(page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Merge newly summoned mounts", exact: true }) })).toContainText("0.5");
    await expect(page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Egg/pet summon then merge", exact: true }) })).toContainText("2.5");
    await selectActivities(page, ["hammers", "mountSummons", "eggMerges"]);
    await expect(page.locator(".war-estimate-total")).toHaveText("47,180–47,210");
    await page.getByRole("button", { name: "Clan totals", exact: true }).click();
    const live = await read<DashboardResponse>(request, "/api/bank");
    const hammers = live.entries.reduce((total, row) => total + row.resources.hammers, 0);
    const fixed = live.entries.reduce((total, row) => total +
      (row.summoningCosts.mount > 0 ? Math.floor(row.resources.mountKeys / row.summoningCosts.mount) * 1080 : 0) +
      row.resources.eggsPetsTotal * 2250, 0);
    const format = new Intl.NumberFormat("en-US");
    await expect(page.locator(".war-estimate-total")).toHaveText(`${format.format(fixed + hammers * 2)}–${format.format(fixed + hammers * 5)}`);
    await page.getByRole("button", { name: "Individual member", exact: true }).click();
    await page.getByLabel("Select member", { exact: true }).selectOption(entry.memberId);
    await expect(page.locator(".war-estimate-total")).toHaveText("47,180–47,210");
    await page.getByRole("button", { name: "Edit rates", exact: true }).click();
    await page.getByLabel("Mount summons points", { exact: true }).fill("1200");
    await page.getByRole("button", { name: "Save point rates", exact: true }).click();
    await expect(page.locator(".war-estimate-total")).toHaveText("47,420–47,450");
    await page.reload();
    await selectActivities(page, ["hammers", "mountSummons", "eggMerges"]);
    await expect(page.locator(".war-estimate-total")).toHaveText("47,420–47,450");
    expect((await read<{ settings: ClanSettings }>(request, "/api/settings")).settings.warRates.mountSummons).toBe(1200);
  } finally {
    await saveBank(request, entry);
    await saveSettings(request, settings);
  }
});

test("snipe creation, attendance, selected points, and archived history use the saved bank", async ({ page, request }) => {
  const { entry } = await ownBank(request);
  const title = `Browser snipe ${Date.now()}`;
  let createdId: string | undefined;
  let secondId: string | undefined;
  try {
    await saveBank(request, { ...entry, resources: { ...entry.resources, hammers: 10 } });
    const beforeAttendance = await read<DewResponse>(request, "/api/dew");
    await page.goto("/snipes");
    await expectHeaderBalance(page, beforeAttendance.balance);
    await page.getByRole("button", { name: "New snipe", exact: true }).click();
    await page.getByLabel("Snipe title", { exact: true }).fill(title);
    await page.getByLabel("Start date and time", { exact: true }).fill("2030-01-14T20:30");
    await selectActivities(page, ["hammers"]);
    await page.getByRole("button", { name: "Create snipe", exact: true }).click();
    const card = page.locator(".snipe-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(card).toBeVisible();
    const plans = await read<SnipesResponse>(request, "/api/snipes");
    createdId = plans.plans.find((plan) => plan.title === title)?.id;
    expect(createdId).toBeTruthy();
    const premature = await request.post(`/api/snipes/${createdId}/attendance`, {
      headers: { Origin: baseURL }, data: { memberId: entry.memberId, attended: true },
    });
    expect(premature.status()).toBe(409);
    await card.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(card).toContainText("20–50");
    const yesPlan = (await read<SnipesResponse>(request, "/api/snipes")).plans.find((plan) => plan.id === createdId)!;
    expect(yesPlan.counts.yes).toBe(1);
    expect(yesPlan.estimate.minimum).toBe(20);
    expect(yesPlan.estimate.maximum).toBe(50);
    expect((await read<DewResponse>(request, "/api/dew")).balance).toBe(beforeAttendance.balance);
    await card.getByRole("button", { name: "No", exact: true }).click();
    await expect(card.locator(".planning-no")).toHaveText("No: 1");
    const noPlan = (await read<SnipesResponse>(request, "/api/snipes")).plans.find((plan) => plan.id === createdId)!;
    expect(noPlan.counts.no).toBe(1);
    expect(noPlan.estimate.minimum).toBe(0);
    await card.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(card.locator(".planning-yes")).toHaveText("Yes: 1");
    // A response saved from another device must become visible without
    // navigating away or discarding a leader's in-progress event form.
    const remoteResponse = await request.post(`/api/snipes/${createdId}/response`, {
      headers: { Origin: baseURL }, data: { answer: "no" },
    });
    expect(remoteResponse.ok(), await remoteResponse.text()).toBeTruthy();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(card.locator(".planning-no")).toHaveText("No: 1");
    await expect(card.locator(".planning-total strong")).toHaveText("0");
    await card.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(card.locator(".planning-yes")).toHaveText("Yes: 1");
    await expect(card.locator(".planning-total strong")).toHaveText("20–50");
    const startedAt = new Date(Date.now() + 2000).toISOString();
    const start = await request.patch(`/api/snipes/${createdId}`, {
      headers: { Origin: baseURL }, data: { startsAt: startedAt },
    });
    expect(start.ok(), await start.text()).toBeTruthy();
    await expect.poll(() => Date.now()).toBeGreaterThanOrEqual(new Date(startedAt).getTime());
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await card.getByRole("checkbox", { name: `${(await ownBank(request)).data.currentUser.username} attended`, exact: true }).check();
    await expect(card.getByText("You attended", { exact: true })).toBeVisible();
    const afterAttendance = await read<DewResponse>(request, "/api/dew");
    expect(afterAttendance.snipeRewardEarned).toBe(true);
    expect(afterAttendance.balance).toBe(beforeAttendance.balance + (beforeAttendance.snipeRewardEarned ? 0 : 10));
    await expectHeaderBalance(page, afterAttendance.balance);
    const repeated = await request.post(`/api/snipes/${createdId}/attendance`, {
      headers: { Origin: baseURL }, data: { memberId: entry.memberId, attended: true },
    });
    expect(repeated.ok(), await repeated.text()).toBeTruthy();
    const secondStart = new Date(Date.now() + 2000).toISOString();
    const second = await request.post("/api/snipes", {
      headers: { Origin: baseURL }, data: { title: `${title} second attendance`, startsAt: secondStart, activities: ["hammers"] },
    });
    expect(second.ok(), await second.text()).toBeTruthy();
    secondId = (await second.json()).plan.id;
    await expect.poll(() => Date.now()).toBeGreaterThanOrEqual(new Date(secondStart).getTime());
    const secondAttendance = await request.post(`/api/snipes/${secondId}/attendance`, {
      headers: { Origin: baseURL }, data: { memberId: entry.memberId, attended: true },
    });
    expect(secondAttendance.ok(), await secondAttendance.text()).toBeTruthy();
    expect((await read<DewResponse>(request, "/api/dew")).balance).toBe(afterAttendance.balance);
    await card.getByRole("button", { name: "Archive snipe", exact: true }).click();
    await expect(card).toHaveCount(0);
    const archived = (await read<SnipesResponse>(request, "/api/snipes")).plans.find((plan) => plan.id === createdId)!;
    await saveBank(request, { ...entry, resources: { ...entry.resources, hammers: 999 } });
    expect((await read<SnipesResponse>(request, "/api/snipes")).plans.find((plan) => plan.id === createdId)).toEqual(archived);
    await page.getByRole("button", { name: /^History/ }).click();
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Yes", exact: true })).toHaveCount(0);
    await expect(card).toContainText("20–50");
  } finally {
    for (const cleanupId of [createdId, secondId]) {
      if (!cleanupId) continue;
      const plan = (await read<SnipesResponse>(request, "/api/snipes")).plans.find((item) => item.id === cleanupId);
      if (plan && !plan.archived) {
        const response = await request.patch(`/api/snipes/${cleanupId}`, {
          headers: { Origin: baseURL }, data: { archived: true },
        });
        expect(response.ok(), await response.text()).toBeTruthy();
      }
    }
    await saveBank(request, entry);
  }
});

test("members can RSVP but only admins see snipe management and attendance controls", async ({ page, request }) => {
  const { data } = await ownBank(request);
  const title = `Member-view snipe ${Date.now()}`;
  const created = await request.post("/api/snipes", {
    headers: { Origin: baseURL },
    data: { title, startsAt: new Date(Date.now() + 86_400_000).toISOString(), activities: ["hammers"] },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = (await created.json()).plan.id as string;
  const session = await read<SessionResponse>(request, "/api/session");
  const memberView = { ...data.currentUser, role: "MEMBER" as const };
  await page.route("**/api/session", (route) => route.fulfill({ json: { ...session, user: memberView } }));
  await page.route(/\/api\/bank(?:\?|$)/, (route) => route.fulfill({ json: { ...data, currentUser: memberView } }));
  try {
    await page.goto("/snipes");
    const card = page.getByRole("region", { name: title, exact: true });
    await expect(card).toBeVisible();
    await expect(page.getByRole("button", { name: "New snipe", exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Edit plan", exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Archive snipe", exact: true })).toHaveCount(0);
    await expect(card.getByRole("checkbox", { name: / attended$/ })).toHaveCount(0);
    await card.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(card.locator(".planning-yes")).toHaveText("Yes: 1");
    await expect(card.getByRole("button", { name: "No", exact: true })).toBeEnabled();
  } finally {
    const response = await request.patch(`/api/snipes/${id}`, { headers: { Origin: baseURL }, data: { archived: true } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
});

test("weekly resource rewards are capped and four cosmetic categories equip independently", async ({ page, request }) => {
  const { entry } = await ownBank(request);
  const before = await read<DewResponse>(request, "/api/dew");
  try {
    await saveBank(request, entry);
    const afterOne = await read<DewResponse>(request, "/api/dew");
    expect(afterOne.resourceRewardEarned).toBe(true);
    expect(afterOne.balance).toBe(before.balance + (before.resourceRewardEarned ? 0 : 20));
    await saveBank(request, entry);
    const afterTwo = await read<DewResponse>(request, "/api/dew");
    expect(afterTwo.balance).toBe(afterOne.balance);
    const tiered = afterTwo.items.filter((item) => !item.legacy);
    expect(tiered).toHaveLength(20);
    for (const cost of [10, 25, 50, 75, 100]) {
      expect(tiered.filter((item) => item.cost === cost).map((item) => item.category).sort())
        .toEqual(["accent", "badge", "frame", "title"]);
    }
    expect(afterTwo.items.filter((item) => item.legacy)).toHaveLength(6);
    await page.goto("/dew-store");
    await expect(page).toHaveURL(`${baseURL}/reward-shop`);
    await expect(page.getByRole("heading", { name: "Reward Shop", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Dew Store", exact: true })).toHaveCount(0);
    await expectHeaderBalance(page, afterTwo.balance);
    await expect(page.locator(".planning-dew-balance")).toHaveAttribute("aria-label", `${afterTwo.balance} Clan Points available`);
    await expect(page.locator(".planning-reward-shop")).not.toContainText(/Dew Points?/);
    const weekly = page.locator('[aria-label="This week’s Clan Point rewards"]');
    await expect(weekly).toContainText("+20 points");
    await expect(weekly).toContainText("+10 points");
    for (const [index, cost] of [10, 25, 50, 75, 100].entries()) {
      const tier = page.getByRole("region", { name: `Tier ${index + 1}: ${cost} Clan Points each`, exact: true });
      await expect(tier.locator("article.dew-item")).toHaveCount(4);
    }
    const selected = [
      afterTwo.items.find((item) => item.id === "forge-scout")!,
      ...["title", "accent", "frame"].map((category) => tiered.find((item) => item.category === category && item.cost === 10)!),
    ];
    const categoryNames = { badge: "badge", title: "title", accent: "name accent", frame: "avatar frame" };
    const equipment = { ...afterTwo.equippedCosmetics };
    let balance = afterTwo.balance;
    for (const item of selected) {
      const card = page.getByRole("article", { name: item.name, exact: true });
      if (!afterTwo.owned.includes(item.id)) {
        expect(balance, `Test wallet must afford ${item.name}`).toBeGreaterThanOrEqual(item.cost);
        await card.getByRole("button", { name: `Unlock for ${item.cost} points`, exact: true }).click();
        balance -= item.cost;
        const purchased = await read<DewResponse>(request, "/api/dew");
        expect(purchased.owned).toContain(item.id);
        expect(purchased.balance).toBe(balance);
        await expectHeaderBalance(page, balance);
        await expect(page.locator(".planning-dew-balance")).toHaveAttribute("aria-label", `${balance} Clan Points available`);
      }
      if (equipment[item.category] !== item.id) await card.getByRole("button", { name: `Equip ${categoryNames[item.category]}`, exact: true }).click();
      equipment[item.category] = item.id;
      await expect.poll(async () => (await read<DewResponse>(request, "/api/dew")).equippedCosmetics).toEqual(equipment);
    }
    await page.reload();
    await expectHeaderBalance(page, balance);
    const profile = page.getByRole("region", { name: "Your equipped rewards", exact: true });
    for (const item of selected) {
      await expect(profile).toContainText(item.name);
      await expect(page.getByRole("article", { name: item.name, exact: true }).getByText("Equipped", { exact: true })).toBeVisible();
    }
    await page.getByRole("article", { name: selected[2].name, exact: true }).getByRole("button", { name: "Remove", exact: true }).click();
    equipment.accent = null;
    await expect.poll(async () => (await read<DewResponse>(request, "/api/dew")).equippedCosmetics).toEqual(equipment);
    await expect(profile).toContainText(selected[1].name);
    await expect(profile).toContainText(selected[3].name);
  } finally {
    for (const [category, itemId] of Object.entries(before.equippedCosmetics)) {
      const response = await request.post("/api/dew/equip", {
        headers: { Origin: baseURL }, data: { itemId, category },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
  }
});

test("weekly snapshots remain fixed when a member's live bank changes", async ({ page, request }) => {
  const { entry } = await ownBank(request);
  const before = await read<BankHistoryResponse>(request, "/api/history");
  expect(before.snapshots.length).toBeGreaterThan(0);
  const historical = before.snapshots.find((snapshot) => snapshot.week < before.current.week);
  expect(historical, "Demo history must contain a completed week").toBeTruthy();
  try {
    await page.goto("/weeks");
    await page.getByRole("button", { name: "Save snapshot now", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("Weekly snapshot saved");
    const captured = await read<BankHistoryResponse>(request, "/api/history");
    const oldIds = new Set(before.snapshots.map((snapshot) => snapshot.id));
    const manual = captured.snapshots.find((snapshot) => !snapshot.automatic && !oldIds.has(snapshot.id));
    expect(manual, "Manual capture creates a distinct immutable snapshot").toBeTruthy();
    await saveBank(request, { ...entry, resources: { ...entry.resources, hammers: entry.resources.hammers + 123 } });
    const after = await read<BankHistoryResponse>(request, "/api/history");
    expect(after.snapshots.find((snapshot) => snapshot.week === historical!.week)).toEqual(historical);
    expect(after.snapshots.find((snapshot) => snapshot.id === manual!.id)).toEqual(manual);
    await page.goto("/weeks");
    await expect(page.getByLabel("History view", { exact: true })).toBeVisible();
    await page.getByLabel("History resource", { exact: true }).selectOption("hammers");
    await page.getByLabel("History view", { exact: true }).selectOption("member");
    await page.getByLabel("History member", { exact: true }).selectOption(entry.memberId);
    const row = page.locator(".history-table tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row.locator("td").nth(3)).toHaveText("+123");
    await page.getByLabel("History bank", { exact: true }).selectOption(manual!.id!);
    await expect(row.locator("td").nth(1)).toHaveText(new Intl.NumberFormat("en-US").format(entry.resources.hammers));
    await page.goto(`/resources?week=${manual!.week}&snapshot=${manual!.id}`);
    await expect(page.getByText(/^Read-only history for the week/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save resources", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Skill Tickets", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Hammers", { exact: true })).toHaveValue(String(entry.resources.hammers));
  } finally {
    await saveBank(request, entry);
  }
});

test("top bar updates weekly Clan Points after an own save and keeps the own wallet while editing another member", async ({ page, request }, testInfo) => {
  const { data, entry } = await ownBank(request);
  const other = data.entries.find((row) => row.memberId !== data.currentUser.id)!;
  expect(other).toBeTruthy();
  const actualWallet = await read<DewResponse>(request, "/api/dew");
  // A controlled wallet gives this browser workflow a fresh weekly award even
  // when other tests have already earned the real fixture's once-weekly reward.
  let balance = 0;
  let ownAwarded = false;
  let walletReads = 0;
  await page.route("**/api/dew", (route) => {
    walletReads++;
    return route.fulfill({ json: { ...actualWallet, balance, resourceRewardEarned: ownAwarded } });
  });
  await page.route(/\/api\/bank(?:\?|$)/, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch();
    if (response.ok() && route.request().postDataJSON().memberId === entry.memberId && !ownAwarded) {
      ownAwarded = true;
      balance += 20;
    }
    return route.fulfill({ response });
  });
  try {
    // Complete the second member's fixture if an isolated planning-only run
    // encounters a bank from before the percentage fields were introduced.
    await saveBank(request, other);
    await page.goto("/resources");
    await expectHeaderBalance(page, 0);
    const readsBeforeSave = walletReads;
    await page.getByLabel("Hammers", { exact: true }).fill(String(entry.resources.hammers + 1));
    await page.getByRole("button", { name: "Save resources", exact: true }).click();
    await expect(page.locator(".toast")).toContainText(/saved/i);
    await expectHeaderBalance(page, 20);
    expect(walletReads).toBeGreaterThan(readsBeforeSave);

    await page.getByLabel("Editing member", { exact: true }).selectOption(other.memberId);
    await expect(page.getByLabel("Hammers", { exact: true })).toHaveValue(String(other.resources.hammers));
    await page.getByLabel("Hammers", { exact: true }).fill(String(other.resources.hammers + 1));
    await page.getByRole("button", { name: "Save resources", exact: true }).click();
    await expect(page.locator(".toast")).toContainText(/saved/i);
    await expectHeaderBalance(page, 20);

    await page.getByRole("button", { name: "Previous week", exact: true }).click();
    await expect(page.getByText(/^Read-only history for the week/)).toBeVisible();
    await expectHeaderBalance(page, 20);
    await page.locator(".topbar-clan-points").click();
    await expect(page).toHaveURL(`${baseURL}/reward-shop`);
    await expect(page.locator(".planning-dew-balance")).toHaveAttribute("aria-label", "20 Clan Points available");

    balance = 1250;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expectHeaderBalance(page, 1250);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await expectHeaderBalance(page, 1250);
      await noHeaderOverlap(page);
      await noPageOverflow(page);
      await page.locator(".topbar").screenshot({ path: testInfo.outputPath(`clan-points-topbar-${width}.png`) });
    }
  } finally {
    await saveBank(request, entry);
    await saveBank(request, other);
  }
});

test("an unavailable Clan Points wallet does not display a false zero and recovers on focus", async ({ page, request }) => {
  const wallet = await read<DewResponse>(request, "/api/dew");
  let available = false;
  await page.route("**/api/dew", (route) => available
    ? route.fulfill({ json: { ...wallet, balance: 0 } })
    : route.fulfill({ status: 503, json: { error: "Wallet is temporarily unavailable." } }));
  const initialFailure = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/dew" && response.status() === 503);
  await page.goto("/");
  await initialFailure;
  const header = page.locator(".topbar-clan-points");
  await expect(header).toBeVisible();
  await expect(header).toHaveAttribute("aria-label", "Clan Points. Open Reward Shop.");
  await expect(header).toHaveAttribute("title", /Unable to refresh your balance/);
  await expect(header).not.toHaveAttribute("aria-label", "0 Clan Points. Open Reward Shop.");
  available = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectHeaderBalance(page, 0);
  available = false;
  const refreshFailure = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/dew" && response.status() === 503);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshFailure;
  await expect(header).toHaveAttribute("title", /Unable to refresh your balance/);
  await expectHeaderBalance(page, 0);
});

test("incomplete war estimates identify missing members and fields without flagging zero inventories", async ({ page, request }) => {
  const current = await read<DashboardResponse>(request, "/api/bank");
  expect(current.entries.length).toBeGreaterThanOrEqual(4);
  const [skill, bonus, zero, absent] = current.entries;
  const fixture = current.entries.filter((row) => row.memberId !== absent.memberId).map((row) => {
    const normal: ResourceEntry = { ...row, resources: { ...EMPTY_RESOURCES },
      summoningCosts: { fiveSkills: 150, mount: 37.5 }, planningDetails: { ...CHANCE_PLANNING_DETAILS } };
    if (row.memberId === skill.memberId) return { ...normal,
      resources: { ...normal.resources, skillTickets: 100 }, summoningCosts: { ...normal.summoningCosts, fiveSkills: 0 } };
    if (row.memberId === bonus.memberId) return { ...normal,
      resources: { ...normal.resources, mountKeys: 75, eggshellsTotal: 1250 },
      summoningCosts: { ...normal.summoningCosts, mount: 0 },
      planningDetails: { ...CHANCE_PLANNING_DETAILS, extraMountChancePercent: undefined, extraPetSummonPercent: undefined } };
    if (row.memberId === zero.memberId) return { ...normal,
      summoningCosts: { fiveSkills: 0, mount: 0 },
      planningDetails: { ...CHANCE_PLANNING_DETAILS, extraMountChancePercent: undefined, extraPetSummonPercent: undefined } };
    return normal;
  });
  const totals = fixture.reduce((sum, row) => {
    for (const { key } of RESOURCE_FIELDS) sum[key] += row.resources[key];
    return sum;
  }, { ...EMPTY_RESOURCES });
  const data = { ...current, entries: fixture, totals,
    summons: { skills: 0, mounts: 0, missingSkillCosts: 1, missingMountCosts: 1 },
    stats: { ...current.stats, submittedMembers: fixture.length, pendingMembers: current.members.length - fixture.length } };
  await page.route(/\/api\/bank(?:\?|$)/, (route) => route.fulfill({ json: data }));
  const username = (memberId: string) => current.members.find((member) => member.id === memberId)!.username;
  await page.goto("/");
  const skillWarning = page.locator(".arsenal-skillTickets").getByRole("button");
  await skillWarning.focus();
  const skillTip = page.getByRole("tooltip").filter({ hasText: username(skill.memberId) });
  await expect(skillTip).toBeVisible();
  await expect(skillTip).toContainText("Cost for 5 skills");
  await expect(skillTip).not.toContainText(username(bonus.memberId));
  await skillWarning.press("Escape");
  await expect(skillWarning).toHaveAttribute("aria-expanded", "false");

  const summaryWarning = page.locator(".arsenal-summary").getByRole("button");
  await summaryWarning.hover();
  const summaryTip = page.getByRole("tooltip").filter({ hasText: "Mount summon cost" });
  await expect(summaryTip).toBeVisible();
  for (const label of [username(skill.memberId), username(bonus.memberId), "Cost for 5 skills", "Mount summon cost", "Extra mount chance %", "Extra pet summon %"]) {
    await expect(summaryTip).toContainText(label);
  }
  await expect(summaryTip).not.toContainText(username(zero.memberId));
  await expect(summaryTip).not.toContainText(username(absent.memberId));
  await summaryWarning.press("Escape");

  const table = page.getByRole("table");
  const memberRow = (memberId: string) => table.getByRole("row").filter({ has: page.locator(".table-member").getByText(username(memberId), { exact: true }) });
  const skillRow = memberRow(skill.memberId);
  const bonusRow = memberRow(bonus.memberId);
  await expect(skillRow).toHaveAttribute("data-planning-incomplete", "true");
  await expect(bonusRow).toHaveAttribute("data-planning-incomplete", "true");
  await expect(table.locator('tbody tr[data-planning-incomplete="true"]')).toHaveCount(2);
  await expect(memberRow(zero.memberId).getByRole("button", { name: /^Missing war-planning data/ })).toHaveCount(0);
  await expect(memberRow(absent.memberId)).toContainText("Not saved yet");

  const memberWarning = bonusRow.getByRole("button", { name: `Missing war-planning data for ${username(bonus.memberId)}`, exact: true });
  await memberWarning.click();
  const memberTip = page.getByRole("tooltip").filter({ hasText: "Mount summon cost" });
  await expect(memberTip).toBeVisible();
  await expect(memberTip).toContainText("Extra mount chance %");
  await expect(memberTip).toContainText("Extra pet summon %");
  await memberWarning.press("Escape");

  await page.setViewportSize({ width: 320, height: 844 });
  await summaryWarning.click();
  await expect(summaryTip).toBeVisible();
  await noPageOverflow(page);
  const bounds = await summaryTip.boundingBox();
  expect(bounds).toBeTruthy();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
  await summaryWarning.click();
  await expect(summaryWarning).toHaveAttribute("aria-expanded", "false");
});

test("new planning and history pages keep the current Clan Points balance usable at narrow mobile widths", async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const wallet = await read<DewResponse>(request, "/api/dew");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/resources", "/members", "/weeks", "/war-points", "/snipes", "/reward-shop"]) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      if (path === "/resources") await expect(page.getByLabel("Skill Tickets", { exact: true })).toBeVisible();
      if (path === "/members") await expect(page.locator(".management-table tbody tr").first()).toBeVisible();
      if (path === "/weeks") await expect(page.locator(".history-table")).toBeVisible();
      if (path === "/war-points") await expect(page.locator(".war-estimate-total")).toBeVisible();
      if (path === "/snipes") await expect(page.getByRole("button", { name: "New snipe", exact: true })).toBeEnabled();
      if (path === "/reward-shop") await expect(page.locator(".planning-dew-balance")).toBeVisible();
      await expectHeaderBalance(page, wallet.balance);
      await noHeaderOverlap(page);
      await noPageOverflow(page);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("mobile-dew-store.png"), fullPage: true });
  expect(errors).toEqual([]);
});
