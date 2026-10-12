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
import { EMPTY_PLANNING_DETAILS, EMPTY_RESOURCES } from "../src/lib/resources";
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
      resources: entry.resources,
      summoningCosts: entry.summoningCosts,
      planningDetails: entry.planningDetails ?? EMPTY_PLANNING_DETAILS,
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
  const history = await read<BankHistoryResponse>(request, "/api/history");
  const completed = history.snapshots.find((snapshot) => snapshot.week < history.current.week);
  expect(completed, "Demo seeds a completed legacy week to verify migration").toBeTruthy();
  const legacy = await read<DashboardResponse>(request, `/api/dashboard?week=${completed!.week}`);
  const bankValues = (entries: ResourceEntry[]) => entries.map((entry) => ({
    memberId: entry.memberId, resources: entry.resources, summoningCosts: entry.summoningCosts,
  })).sort((a, b) => a.memberId.localeCompare(b.memberId));
  // Initial replay must preserve every old weekly submission, including members
  // who did not have a bank at an earlier intermediate replay timestamp.
  expect(bankValues(completed!.entries)).toEqual(bankValues(legacy.entries));
});

test("personal bank, levels, costs, and explicit merge counts survive a page reload", async ({ page, request }) => {
  const { entry } = await ownBank(request);
  try {
    await page.goto("/resources");
    await page.getByLabel("Skill Tickets", { exact: true }).fill("600");
    await page.getByLabel("Mount Keys", { exact: true }).fill("75");
    await page.getByLabel("Hammers", { exact: true }).fill("10");
    await page.getByLabel("Total eggs/pets", { exact: true }).fill("20");
    await page.getByLabel("Cost of summoning 5 skills", { exact: true }).fill("150");
    await page.getByLabel("Cost per mount summon", { exact: true }).fill("37.5");
    for (const [label, value] of [
      ["Skill level", "42"], ["Mount level", "43"], ["Egg/pet level", "44"],
      ["Newly summoned mount merges", "2"], ["Existing egg/pet merges", "3"],
      ["Egg/pet summon then merge", "4"],
    ]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel("Notes", { exact: true }).fill("Persistent bank browser fixture.");
    await page.getByRole("button", { name: "Save resources", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(/saved/i);
    await page.reload();
    await expect(page.getByLabel("Skill Tickets", { exact: true })).toHaveValue("600");
    await expect(page.getByLabel("Cost per mount summon", { exact: true })).toHaveValue("37.5");
    await expect(page.getByLabel("Newly summoned mount merges", { exact: true })).toHaveValue("2");
    await expect(page.getByLabel("Existing egg/pet merges", { exact: true })).toHaveValue("3");
    await expect(page.getByLabel("Egg/pet summon then merge", { exact: true })).toHaveValue("4");
    const saved = (await ownBank(request)).entry;
    expect(saved.planningDetails).toEqual({
      skillLevel: 42, mountLevel: 43, eggLevel: 44,
      newMountMerges: 2, eggMerges: 3, eggSummonMerges: 4,
    });
    expect(saved.summoningCosts).toEqual({ fiveSkills: 150, mount: 37.5 });
    await page.goto("/");
    await expect(page.getByText("Potions", { exact: true })).toHaveCount(0);
    await expect(page.locator(".eggs-pets-card")).toBeVisible();
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
    await expect(page.getByRole("status")).toContainText("Clan capacity saved");
    await page.reload();
    await expect(page.getByLabel("Member capacity", { exact: true })).toHaveValue("99");
    expect((await read<{ settings: ClanSettings }>(request, "/api/settings")).settings.capacity).toBe(99);
  } finally {
    await saveSettings(request, settings);
  }
});

test("war estimates combine selected explicit actions with the hammer range across scopes", async ({ page, request }) => {
  const { entry } = await ownBank(request);
  const { settings } = await read<{ settings: ClanSettings }>(request, "/api/settings");
  try {
    await saveSettings(request, { ...settings, warRates: DEFAULT_WAR_RATES });
    await saveBank(request, {
      ...entry,
      resources: { ...EMPTY_RESOURCES, skillTickets: 600, mountKeys: 75, hammers: 10, mountsToMerge: 4, eggsPetsTotal: 20 },
      summoningCosts: { fiveSkills: 150, mount: 37.5 },
      planningDetails: { ...EMPTY_PLANNING_DETAILS, newMountMerges: 2, eggMerges: 3, eggSummonMerges: 4 },
    });
    await page.goto("/war-points");
    await page.getByRole("button", { name: "My totals", exact: true }).click();
    await selectActivities(page, ["hammers", "mountSummons", "eggMerges"]);
    // 2 mounts × 1,080 + 3 egg merges × 2,250 + 10 hammers × 2–5.
    await expect(page.locator(".war-estimate-total")).toHaveText("8,930–8,960");
    await page.getByRole("button", { name: "Clan totals", exact: true }).click();
    const live = await read<DashboardResponse>(request, "/api/bank");
    const hammers = live.entries.reduce((total, row) => total + row.resources.hammers, 0);
    const fixed = live.entries.reduce((total, row) => total +
      (row.summoningCosts.mount > 0 ? Math.floor(row.resources.mountKeys / row.summoningCosts.mount) * 1080 : 0) +
      (row.planningDetails?.eggMerges ?? 0) * 2250, 0);
    const format = new Intl.NumberFormat("en-US");
    await expect(page.locator(".war-estimate-total")).toHaveText(`${format.format(fixed + hammers * 2)}–${format.format(fixed + hammers * 5)}`);
    await page.getByRole("button", { name: "Individual member", exact: true }).click();
    await page.getByLabel("Select member", { exact: true }).selectOption(entry.memberId);
    await expect(page.locator(".war-estimate-total")).toHaveText("8,930–8,960");
    await page.getByRole("button", { name: "Edit rates", exact: true }).click();
    await page.getByLabel("Mount summons points", { exact: true }).fill("1200");
    await page.getByRole("button", { name: "Save point rates", exact: true }).click();
    await expect(page.locator(".war-estimate-total")).toHaveText("9,170–9,200");
    await page.reload();
    await selectActivities(page, ["hammers", "mountSummons", "eggMerges"]);
    await expect(page.locator(".war-estimate-total")).toHaveText("9,170–9,200");
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
  try {
    await saveBank(request, { ...entry, resources: { ...entry.resources, hammers: 10 } });
    await page.goto("/snipes");
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
    await card.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(card).toContainText("20–50");
    const yesPlan = (await read<SnipesResponse>(request, "/api/snipes")).plans.find((plan) => plan.id === createdId)!;
    expect(yesPlan.counts.yes).toBe(1);
    expect(yesPlan.estimate.minimum).toBe(20);
    expect(yesPlan.estimate.maximum).toBe(50);
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
    await page.getByRole("button", { name: "Refresh plans", exact: true }).click();
    await expect(card.locator(".planning-no")).toHaveText("No: 1");
    await expect(card.locator(".planning-total strong")).toHaveText("0");
    await card.getByRole("button", { name: "Yes", exact: true }).click();
    await expect(card.locator(".planning-yes")).toHaveText("Yes: 1");
    await expect(card.locator(".planning-total strong")).toHaveText("20–50");
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
    if (createdId) {
      const plan = (await read<SnipesResponse>(request, "/api/snipes")).plans.find((item) => item.id === createdId);
      if (plan && !plan.archived) {
        const response = await request.patch(`/api/snipes/${createdId}`, {
          headers: { Origin: baseURL }, data: { archived: true },
        });
        expect(response.ok(), await response.text()).toBeTruthy();
      }
    }
    await saveBank(request, entry);
  }
});

test("daily Dew is capped and an owned cosmetic can be equipped and removed", async ({ page, request }) => {
  const { entry } = await ownBank(request);
  const before = await read<DewResponse>(request, "/api/dew");
  try {
    await saveBank(request, entry);
    const afterOne = await read<DewResponse>(request, "/api/dew");
    expect(afterOne.earnedToday).toBe(true);
    expect(afterOne.balance).toBe(before.balance + (before.earnedToday ? 0 : 1));
    await saveBank(request, entry);
    const afterTwo = await read<DewResponse>(request, "/api/dew");
    expect(afterTwo.balance).toBe(afterOne.balance);
    const affordable = afterTwo.items.find((item) => !afterTwo.owned.includes(item.id) && item.cost <= afterTwo.balance)
      ?? afterTwo.items.find((item) => afterTwo.owned.includes(item.id));
    expect(affordable, "Seed demo Dew so a cosmetic can be purchased").toBeTruthy();
    await page.goto("/dew-store");
    const card = page.locator(".dew-item").filter({ has: page.getByRole("heading", { name: affordable!.name, exact: true }) });
    if (!afterTwo.owned.includes(affordable!.id)) {
      await card.getByRole("button", { name: /buy|unlock/i }).click();
      await expect(card.getByRole("button", { name: "Equip badge", exact: true })).toBeVisible();
      const purchased = await read<DewResponse>(request, "/api/dew");
      expect(purchased.owned).toContain(affordable!.id);
      expect(purchased.balance).toBe(afterTwo.balance - affordable!.cost);
    }
    if (afterTwo.equipped !== affordable!.id) await card.getByRole("button", { name: "Equip badge", exact: true }).click();
    await expect.poll(async () => (await read<DewResponse>(request, "/api/dew")).equipped).toBe(affordable!.id);
    await page.reload();
    await expect(card.getByText("Equipped", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Remove badge", exact: true }).click();
    await expect.poll(async () => (await read<DewResponse>(request, "/api/dew")).equipped).toBeNull();
  } finally {
    const response = await request.post("/api/dew/equip", {
      headers: { Origin: baseURL }, data: { itemId: before.equipped },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
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
    await expect(page.getByRole("status")).toContainText("Weekly snapshot saved");
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

test("new planning and history pages remain usable at narrow mobile widths", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/resources", "/members", "/weeks", "/war-points", "/snipes", "/dew-store"]) {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      if (path === "/resources") await expect(page.getByLabel("Skill Tickets", { exact: true })).toBeVisible();
      if (path === "/members") await expect(page.locator(".management-table tbody tr").first()).toBeVisible();
      if (path === "/weeks") await expect(page.locator(".history-table")).toBeVisible();
      if (path === "/war-points") await expect(page.locator(".war-estimate-total")).toBeVisible();
      if (path === "/snipes") await expect(page.getByRole("button", { name: "New snipe", exact: true })).toBeEnabled();
      if (path === "/dew-store") await expect(page.locator(".planning-dew-balance")).toBeVisible();
      await noPageOverflow(page);
    }
  }
  await page.screenshot({ path: testInfo.outputPath("mobile-dew-store.png"), fullPage: true });
  expect(errors).toEqual([]);
});
