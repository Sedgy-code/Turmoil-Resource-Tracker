import { existsSync } from "node:fs";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type {
  DashboardResponse,
  Member,
  SessionResponse,
} from "../src/lib/types";
import { EMPTY_RESOURCES, RESOURCE_FIELDS } from "../src/lib/resources";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
test.use({
  baseURL,
  browserName: "chromium",
  launchOptions: { executablePath },
  viewport: { width: 1440, height: 1000 },
});
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

async function demoSession(
  request: APIRequestContext,
): Promise<SessionResponse> {
  const response = await request.get("/api/session");
  expect(response.ok()).toBeTruthy();
  const session = (await response.json()) as SessionResponse;
  // Browser workflows must never mutate a real clan's database.
  test.skip(
    !session.demo || !session.user,
    "Run browser workflows with DEMO_MODE=true on a development server.",
  );
  return session;
}
async function dashboard(
  request: APIRequestContext,
  week?: string,
): Promise<DashboardResponse> {
  const response = await request.get(
    `/api/dashboard${week ? `?week=${week}` : ""}`,
  );
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<DashboardResponse>;
}
async function patchMember(request: APIRequestContext, member: Member) {
  const response = await request.patch(`/api/members/${member.id}`, {
    headers: { Origin: baseURL },
    data: { role: member.role, active: member.active },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  await demoSession(request);
  // A persisted demo database may have crossed into a new week since it was seeded.
  // Keep required demo fixtures and their cost ranges usable across app updates.
  const current = await dashboard(request);
  const previousDate = new Date(`${current.week}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 7);
  const previous = await dashboard(
    request,
    previousDate.toISOString().slice(0, 10),
  );
  const target = current.members.find(
    (member) =>
      member.id !== current.currentUser.id && member.role === "MEMBER",
  );
  expect(
    target,
    "The demo fixture needs an active nonadmin member",
  ).toBeTruthy();
  for (const [data, memberId] of [
    [current, current.currentUser.id],
    [current, target!.id],
    [previous, current.currentUser.id],
  ] as const) {
    const existing = data.entries.find((entry) => entry.memberId === memberId);
    const skillCost = existing?.summoningCosts.fiveSkills ?? 0;
    const mountCost = existing?.summoningCosts.mount ?? 0;
    const validSkillCost = skillCost >= 150 && skillCost <= 200 && Number.isInteger(skillCost * 10);
    const validMountCost = mountCost >= 37.5 && mountCost <= 50;
    if (existing && validSkillCost && validMountCost) continue;
    const response = await request.put("/api/resources", {
      headers: { Origin: baseURL },
      data: {
        week: data.week,
        memberId,
        resources: existing?.resources ?? {
          skillTickets: data.week === current.week ? 321 : 125,
          hammers: 25,
        },
        summoningCosts: {
          fiveSkills: validSkillCost ? skillCost : 150,
          mount: validMountCost ? mountCost : 37.5,
        },
        notes: existing?.notes ?? "Demo browser-test fixture.",
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
});

test("desktop resources persist, copy from history, update totals, and export complete CSV", async ({
  page,
  request,
}, testInfo) => {
  await demoSession(request);
  const original = await dashboard(request);
  const ownEntry = original.entries.find(
    (entry) => entry.memberId === original.currentUser.id,
  )!;
  expect(ownEntry).toBeTruthy();
  const previousWeek = new Date(`${original.week}T00:00:00Z`);
  previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
  const previous = await dashboard(
    request,
    previousWeek.toISOString().slice(0, 10),
  );
  const previousEntry = previous.entries.find(
    (entry) => entry.memberId === original.currentUser.id,
  )!;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  try {
    const previousCosts = { fiveSkills: 175.5, mount: 37.5 };
    const seededPrevious = await request.put("/api/resources", {
      headers: { Origin: baseURL },
      data: { week: previousEntry.week, memberId: previousEntry.memberId,
        resources: previousEntry.resources, summoningCosts: previousCosts,
        notes: previousEntry.notes },
    });
    expect(seededPrevious.ok(), await seededPrevious.text()).toBeTruthy();
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Resource Dashboard" }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await noPageOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("desktop-dashboard.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: "My Resources", exact: true }).click();
    await expect(page.getByLabel("Skill Tickets", { exact: true })).toHaveValue(
      String(ownEntry.resources.skillTickets),
    );
    await expect(page.getByLabel("Total eggs/pets", { exact: true })).toHaveValue(
      String(ownEntry.resources.eggsPetsTotal),
    );
    await page.getByLabel("Skill Tickets", { exact: true }).fill("54321");
    await page.getByLabel("Cost of summoning 5 skills", { exact: true }).fill("185.5");
    await page.getByLabel("Cost per mount summon", { exact: true }).fill("45.25");
    await page.getByLabel("Total eggs/pets", { exact: true }).fill("16");
    await page
      .getByLabel("Notes", { exact: true })
      .fill("Browser verification — saved and reloaded.");
    await page
      .getByRole("button", { name: "Save resources", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("resources are saved");
    await page.reload();
    await expect(page.getByLabel("Skill Tickets", { exact: true })).toHaveValue(
      "54321",
    );
    await expect(page.getByLabel("Total eggs/pets", { exact: true })).toHaveValue("16");
    await expect(page.getByLabel("Cost of summoning 5 skills", { exact: true })).toHaveValue("185.5");
    await expect(page.getByLabel("Cost per mount summon", { exact: true })).toHaveValue("45.25");
    await expect(page.getByLabel("Notes", { exact: true })).toHaveValue(
      "Browser verification — saved and reloaded.",
    );
    await page
      .getByRole("button", { name: "Copy previous week", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Previous week copied and saved",
    );
    await expect(page.getByLabel("Skill Tickets", { exact: true })).toHaveValue(
      String(previousEntry.resources.skillTickets),
    );
    await expect(page.getByLabel("Total eggs/pets", { exact: true })).toHaveValue(
      String(previousEntry.resources.eggsPetsTotal),
    );
    const copied = await dashboard(request);
    expect(copied.entries.find((entry) => entry.memberId === copied.currentUser.id)?.summoningCosts)
      .toEqual(previousCosts);
    await expect(page.getByLabel("Cost of summoning 5 skills", { exact: true })).toHaveValue("175.5");
    await expect(page.getByLabel("Cost per mount summon", { exact: true })).toHaveValue("37.5");
    expect(
      copied.entries.find((entry) => entry.memberId === copied.currentUser.id)
        ?.resources,
    ).toEqual(previousEntry.resources);
    expect(
      (await dashboard(request, previous.week)).entries.find(
        (entry) => entry.memberId === original.currentUser.id,
      )?.resources,
    ).toEqual(previousEntry.resources);
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(
      page
        .locator(".stat-card")
        .filter({ hasText: "Skill Tickets" })
        .locator(".stat-number"),
    ).toHaveText(
      new Intl.NumberFormat("en-US").format(copied.totals.skillTickets),
    );
    await expect(
      page.locator(".stat-card").filter({ hasText: "Skill Tickets" })
        .locator(".war-points-total"),
    ).toHaveText(new Intl.NumberFormat("en-US").format(copied.summons.skills * 225));
    await expect(
      page.locator(".stat-card").filter({ hasText: "Mounts to Merge" })
        .locator(".war-points-total"),
    ).toHaveText(new Intl.NumberFormat("en-US").format(copied.totals.mountsToMerge * 1_080));
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `turmoil-resources-${original.week}.csv`,
    );
    const stream = await download.createReadStream();
    expect(stream).toBeTruthy();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv.trim().split("\r\n")).toHaveLength(7);
    expect(csv).toContain(`Skill Tickets,${copied.totals.skillTickets}`);
    expect(csv).toContain(`Total eggs/pets,${copied.totals.eggsPetsTotal}`);
    expect(csv).not.toMatch(/Common|Rare|Epic|Legendary|Ultimate|Mythic/);
    await expect(page.locator(".eggs-pets-card")).toContainText(
      new Intl.NumberFormat("en-US").format(copied.totals.eggsPetsTotal),
    );
    await expect(page.getByRole("columnheader", { name: "Total eggs/pets", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Weeks", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Weeks", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View dashboard" }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    const restored = await request.put("/api/resources", {
      headers: { Origin: baseURL },
      data: {
        week: ownEntry.week,
        memberId: ownEntry.memberId,
        resources: ownEntry.resources,
        summoningCosts: ownEntry.summoningCosts,
        notes: ownEntry.notes,
      },
    });
    expect(restored.ok(), await restored.text()).toBeTruthy();
    const restoredPrevious = await request.put("/api/resources", {
      headers: { Origin: baseURL },
      data: { week: previousEntry.week, memberId: previousEntry.memberId,
        resources: previousEntry.resources, summoningCosts: previousEntry.summoningCosts,
        notes: previousEntry.notes },
    });
    expect(restoredPrevious.ok(), await restoredPrevious.text()).toBeTruthy();
  }
});

test("resource fields can be cleared, typed without a leading zero, and saved blank as zero", async ({
  page,
  request,
}) => {
  await demoSession(request);
  const original = await dashboard(request);
  const ownEntry = original.entries.find(
    (entry) => entry.memberId === original.currentUser.id,
  )!;
  expect(ownEntry).toBeTruthy();
  try {
    const reset = await request.put("/api/resources", {
      headers: { Origin: baseURL },
      data: {
        week: ownEntry.week,
        memberId: ownEntry.memberId,
        resources: EMPTY_RESOURCES,
        notes: ownEntry.notes,
      },
    });
    expect(reset.ok(), await reset.text()).toBeTruthy();
    await page.goto(`/resources?week=${original.week}`);
    for (const { label } of RESOURCE_FIELDS) {
      const input = page.getByLabel(label, { exact: true });
      await expect(input).toHaveValue("0");
      await input.fill("");
      await expect(input).toHaveValue("");
    }
    await expect(page.locator(".save-bar")).toContainText("Unsaved changes");
    const tickets = page.getByLabel("Skill Tickets", { exact: true });
    await tickets.pressSequentially("42");
    await expect(tickets).toHaveValue("42");
    const eggs = page.getByLabel("Total eggs/pets", { exact: true });
    await eggs.pressSequentially("7");
    await expect(eggs).toHaveValue("7");
    for (const invalid of ["-1", "1.5", "1000000001"]) {
      await tickets.fill(invalid);
      expect(
        await tickets.evaluate((input: HTMLInputElement) =>
          input.checkValidity(),
        ),
      ).toBeFalsy();
    }
    await tickets.fill("42");
    await page
      .getByRole("button", { name: "Save resources", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("resources are saved");
    const expected = {
      ...EMPTY_RESOURCES,
      skillTickets: 42,
      eggsPetsTotal: 7,
    };
    const saved = await dashboard(request, original.week);
    expect(
      saved.entries.find((entry) => entry.memberId === ownEntry.memberId)
        ?.resources,
    ).toEqual(expected);
    await page.reload();
    for (const { key, label } of RESOURCE_FIELDS) {
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(
        String(expected[key as keyof typeof expected]),
      );
    }
    await expect(page.locator(".save-bar")).toContainText("All changes saved");
  } finally {
    const restored = await request.put("/api/resources", {
      headers: { Origin: baseURL },
      data: {
        week: ownEntry.week,
        memberId: ownEntry.memberId,
        resources: ownEntry.resources,
        notes: ownEntry.notes,
      },
    });
    expect(restored.ok(), await restored.text()).toBeTruthy();
  }
});

test("weekly summoning costs persist and enforce required decimal ranges", async ({ page, request }) => {
  await demoSession(request);
  const original = await dashboard(request);
  const own = original.entries.find((entry) => entry.memberId === original.currentUser.id)!;
  const other = original.entries.find((entry) => entry.memberId !== own.memberId)!;
  expect(own).toBeTruthy();
  expect(other).toBeTruthy();
  const skillCostLabel = "Cost of summoning 5 skills";
  const mountCostLabel = "Cost per mount summon";
  let costSaves = 0;
  page.on("request", (outgoing) => {
    if (new URL(outgoing.url()).pathname === "/api/resources" && outgoing.method() === "PUT") costSaves++;
  });
  try {
    const seeded = await request.put("/api/resources", {
      headers: { Origin: baseURL },
      data: { week: other.week, memberId: other.memberId,
        resources: { ...EMPTY_RESOURCES, skillTickets: 600, mountKeys: 90 },
        summoningCosts: { fiveSkills: 150, mount: 45 }, notes: other.notes },
    });
    expect(seeded.ok(), await seeded.text()).toBeTruthy();
    await page.goto(`/resources?week=${original.week}`);
    await page.getByLabel("Skill Tickets", { exact: true }).fill("702");
    await page.getByLabel("Mount Keys", { exact: true }).fill("75");
    const skillCost = page.getByLabel(skillCostLabel, { exact: true });
    const mountCost = page.getByLabel(mountCostLabel, { exact: true });
    for (const [input, invalidValues, validValues] of [
      [skillCost, ["0", "149.9", "200.1", "175.55"], ["150", "150.1", "175.5", "200"]],
      [mountCost, ["0", "37.49", "50.01"], ["37.5", "45.25", "50"]],
    ] as const) {
      await expect(input).toHaveAttribute("required", "");
      await expect(input).toHaveAttribute("inputmode", "decimal");
      for (const invalid of invalidValues) {
        await input.fill(invalid);
        expect(await input.evaluate((field: HTMLInputElement) => field.checkValidity())).toBeFalsy();
      }
      for (const valid of validValues) {
        await input.fill(valid);
        expect(await input.evaluate((field: HTMLInputElement) => field.checkValidity())).toBeTruthy();
      }
      await input.fill("");
      await expect(input).toHaveValue("");
      expect(await input.evaluate((field: HTMLInputElement) => field.checkValidity())).toBeFalsy();
    }
    await skillCost.pressSequentially("175.5");
    await mountCost.pressSequentially("37.5");
    await expect(page.locator(".save-bar")).toContainText("Unsaved changes");
    await page.getByRole("button", { name: "Save resources", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("resources are saved");
    expect(costSaves).toBe(1);
    await page.reload();
    await expect(page.getByLabel(skillCostLabel, { exact: true })).toHaveValue("175.5");
    await expect(page.getByLabel(mountCostLabel, { exact: true })).toHaveValue("37.5");
    const saved = await dashboard(request, original.week);
    expect(saved.entries.find((entry) => entry.memberId === own.memberId)?.summoningCosts)
      .toEqual({ fiveSkills: 175.5, mount: 37.5 });
    const baseline = original.entries.filter((entry) => entry.memberId !== own.memberId && entry.memberId !== other.memberId);
    const baselineSkills = baseline.reduce((sum, entry) => sum + (entry.summoningCosts.fiveSkills > 0
      ? entry.resources.skillTickets * 5 / entry.summoningCosts.fiveSkills : 0), 0);
    const baselineMounts = baseline.reduce((sum, entry) => sum + (entry.summoningCosts.mount > 0
      ? entry.resources.mountKeys / entry.summoningCosts.mount : 0), 0);
    expect(saved.summons.skills).toBe(Math.round(baselineSkills + 40));
    expect(saved.summons.mounts).toBe(Math.round(baselineMounts + 4));
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    const skillCard = page.locator(".stat-card").filter({ hasText: "Skill Tickets" });
    const mountCard = page.locator(".stat-card").filter({ hasText: "Mount Keys" });
    await expect(skillCard.locator(".stat-summons")).toContainText("Total skill summons");
    await expect(skillCard.locator(".summon-total")).toHaveText(new Intl.NumberFormat("en-US").format(saved.summons.skills));
    await expect(skillCard.locator(".war-points-total")).toHaveText(new Intl.NumberFormat("en-US").format(saved.summons.skills * 225));
    await expect(mountCard.locator(".stat-summons")).toContainText("Total mount summons");
    await expect(mountCard.locator(".summon-total")).toHaveText(new Intl.NumberFormat("en-US").format(saved.summons.mounts));
    const headers = page.getByRole("table").locator("thead");
    await expect(headers).not.toContainText(/summon|cost/i);
    await page.getByRole("link", { name: "My Resources", exact: true }).click();
    await page.getByLabel(skillCostLabel, { exact: true }).fill("");
    await page.getByLabel(mountCostLabel, { exact: true }).fill("");
    await page.getByLabel("Total eggs/pets", { exact: true }).fill("");
    await page.getByRole("button", { name: "Save resources", exact: true }).click();
    await expect(page.getByLabel(skillCostLabel, { exact: true })).toBeFocused();
    expect(costSaves).toBe(1);
    const blocked = await dashboard(request, original.week);
    expect(blocked.entries.find((entry) => entry.memberId === own.memberId)?.summoningCosts)
      .toEqual({ fiveSkills: 175.5, mount: 37.5 });
    await page.getByLabel(skillCostLabel, { exact: true }).fill("0");
    await page.getByLabel(mountCostLabel, { exact: true }).fill("0");
    for (const label of [skillCostLabel, mountCostLabel]) {
      expect(await page.getByLabel(label, { exact: true }).evaluate((field: HTMLInputElement) => field.checkValidity())).toBeFalsy();
    }
    await page.getByLabel(skillCostLabel, { exact: true }).fill("200");
    await page.getByLabel(mountCostLabel, { exact: true }).fill("50");
    await page.getByRole("button", { name: "Save resources", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("resources are saved");
    expect(costSaves).toBe(2);
    const cleared = await dashboard(request, original.week);
    expect(cleared.entries.find((entry) => entry.memberId === own.memberId)?.summoningCosts).toEqual({ fiveSkills: 200, mount: 50 });
    expect(cleared.entries.find((entry) => entry.memberId === own.memberId)?.resources.eggsPetsTotal).toBe(0);
    expect(cleared.summons.skills).toBe(Math.round(baselineSkills + 37.55));
    expect(cleared.summons.mounts).toBe(Math.round(baselineMounts + 3.5));
    expect(cleared.summons.missingSkillCosts).toBe(saved.summons.missingSkillCosts);
    expect(cleared.summons.missingMountCosts).toBe(saved.summons.missingMountCosts);
    await page.reload();
    await expect(page.getByLabel(skillCostLabel, { exact: true })).toHaveValue("200");
    await expect(page.getByLabel(mountCostLabel, { exact: true })).toHaveValue("50");
    await expect(page.getByLabel("Total eggs/pets", { exact: true })).toHaveValue("0");
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    if (cleared.summons.missingSkillCosts > 0) {
      await expect(skillCard.locator(".summon-warning")).toContainText(String(cleared.summons.missingSkillCosts));
    } else {
      await expect(skillCard.locator(".summon-warning")).toHaveCount(0);
    }
    await expect(skillCard.locator(".war-points-total")).toHaveText(new Intl.NumberFormat("en-US").format(cleared.summons.skills * 225));
    if (cleared.summons.missingMountCosts > 0) {
      await expect(mountCard.locator(".summon-warning")).toContainText(String(cleared.summons.missingMountCosts));
    } else {
      await expect(mountCard.locator(".summon-warning")).toHaveCount(0);
    }
  } finally {
    for (const entry of [own, other]) {
      const restored = await request.put("/api/resources", {
        headers: { Origin: baseURL },
        data: { week: entry.week, memberId: entry.memberId, resources: entry.resources,
          summoningCosts: entry.summoningCosts, notes: entry.notes },
      });
      expect(restored.ok(), await restored.text()).toBeTruthy();
    }
  }
});

test("refreshed clan profile replaces the login snapshot and retries a changed avatar", async ({
  page,
  request,
}) => {
  const session = await demoSession(request);
  const original = await dashboard(request);
  const brokenAvatar = "/browser-avatar-missing.svg";
  const updatedAvatar = "/browser-avatar-updated.svg";
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        ...session,
        user: {
          ...original.currentUser,
          username: "OldDiscordUsername",
          avatarUrl: brokenAvatar,
        },
      },
    }),
  );
  await page.route(`**${brokenAvatar}`, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.route(`**${updatedAvatar}`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#4fc491"/></svg>',
    }),
  );
  await page.route(/\/api\/dashboard(?:\?|$)/, (route) => {
    const week =
      new URL(route.request().url()).searchParams.get("week") || original.week;
    const updated = week !== original.week;
    const profile = {
      ...original.currentUser,
      username: updated ? "UpdatedClanNickname" : "CurrentClanNickname",
      avatarUrl: updated ? updatedAvatar : brokenAvatar,
    };
    return route.fulfill({
      json: {
        ...original,
        week,
        currentUser: profile,
        members: original.members.map((member) =>
          member.id === profile.id ? profile : member,
        ),
      },
    });
  });
  await page.goto(`/resources?week=${original.week}`);
  const sidebarProfile = page.locator(".sidebar-profile");
  await expect(sidebarProfile.locator("strong")).toHaveText(
    "CurrentClanNickname",
  );
  await expect(sidebarProfile.locator(".avatar img")).toHaveCount(0);
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(sidebarProfile.locator("strong")).toHaveText(
    "UpdatedClanNickname",
  );
  const avatar = sidebarProfile.locator(".avatar img");
  await expect(avatar).toHaveAttribute("src", updatedAvatar);
  await expect
    .poll(() =>
      avatar.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBeTruthy();
  await expect(page.locator(".topbar-actions > .avatar img")).toHaveAttribute(
    "src",
    updatedAvatar,
  );
});

test("admin can edit another member, promote, deactivate, and restore access", async ({
  page,
  request,
}) => {
  const session = await demoSession(request);
  test.skip(
    session.user?.role !== "ADMIN",
    "This workflow requires the demo admin.",
  );
  const original = await dashboard(request);
  const member = original.members.find(
    (candidate) =>
      candidate.id !== original.currentUser.id && candidate.role === "MEMBER",
  )!;
  const entry = original.entries.find(
    (candidate) => candidate.memberId === member.id,
  )!;
  expect(member).toBeTruthy();
  expect(entry).toBeTruthy();
  page.on("dialog", (dialog) => dialog.accept());
  try {
    await page.goto(`/resources?week=${original.week}&member=${member.id}`);
    await expect(page.getByLabel("Editing member")).toHaveValue(member.id);
    await page.getByLabel("Hammers", { exact: true }).fill("43210");
    await page
      .getByRole("button", { name: "Save resources", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("resources are saved");
    const edited = await dashboard(request);
    expect(
      edited.entries.find((candidate) => candidate.memberId === member.id)
        ?.updatedBy.id,
    ).toBe(original.currentUser.id);
    expect(
      edited.entries.find((candidate) => candidate.memberId === member.id)
        ?.resources.hammers,
    ).toBe(43210);
    await page
      .getByRole("link", { name: "Manage Members", exact: true })
      .click();
    const row = page.getByRole("row").filter({ hasText: member.username });
    await row.getByRole("button", { name: "Make admin", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Demote", exact: true }),
    ).toBeVisible();
    await row.getByRole("button", { name: "Deactivate", exact: true }).click();
    await expect(row).toHaveCount(0);
    const inactive = await dashboard(request);
    expect(
      inactive.members.some((candidate) => candidate.id === member.id),
    ).toBeFalsy();
    expect(
      inactive.entries.some((candidate) => candidate.memberId === member.id),
    ).toBeFalsy();
    expect(inactive.totals.hammers).toBe(edited.totals.hammers - 43210);
    await page
      .getByRole("button", { name: "Inactive members", exact: true })
      .click();
    await row.getByRole("button", { name: "Reactivate", exact: true }).click();
    await expect(row).toHaveCount(0);
    await page
      .getByRole("button", { name: "Active members", exact: true })
      .click();
    await row.getByRole("button", { name: "Demote", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Make admin", exact: true }),
    ).toBeVisible();
  } finally {
    await patchMember(request, member);
    const restored = await request.put("/api/resources", {
      headers: { Origin: baseURL },
      data: {
        week: entry.week,
        memberId: member.id,
        resources: entry.resources,
        notes: entry.notes,
      },
    });
    expect(restored.ok(), await restored.text()).toBeTruthy();
  }
});

test("mobile dashboard, menu, complete resource form, and week navigation fit the viewport", async ({
  page,
  request,
}, testInfo) => {
  await demoSession(request);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Resource Dashboard" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await noPageOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("mobile-dashboard.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page.getByRole("link", { name: "My Resources", exact: true }).click();
  await expect(page.getByLabel("Skill Tickets", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Total eggs/pets", { exact: true })).toHaveCount(1);
  await expect(page.locator('input[type="number"]')).toHaveCount(8);
  await expect(page.getByLabel("Cost of summoning 5 skills", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Cost per mount summon", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save resources", exact: true }),
  ).toBeVisible();
  await noPageOverflow(page);
  const selectedWeek = await page
    .getByLabel("Select week", { exact: true })
    .inputValue();
  await page
    .getByRole("button", { name: "Previous week", exact: true })
    .click();
  await expect(page.getByLabel("Select week", { exact: true })).not.toHaveValue(
    selectedWeek,
  );
  await expect(page.getByLabel("Skill Tickets", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(page.getByLabel("Select week", { exact: true })).toHaveValue(
    selectedWeek,
  );
  await expect(page.getByLabel("Skill Tickets", { exact: true })).toBeVisible();
  await noPageOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("mobile-resources.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await noPageOverflow(page);
  await expect(page.getByLabel("Cost of summoning 5 skills", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Cost per mount summon", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.locator(".stat-summons")).toHaveCount(2);
  await expect(page.locator(".stat-war-points")).toHaveCount(2);
  await noPageOverflow(page);
  expect(errors).toEqual([]);
});

test("a delayed old-week response cannot replace the selected week's inventory", async ({
  page,
  request,
}) => {
  await demoSession(request);
  const current = await dashboard(request);
  const currentEntry = current.entries.find(
    (entry) => entry.memberId === current.currentUser.id,
  )!;
  const previousDate = new Date(`${current.week}T00:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 7);
  const previousWeek = previousDate.toISOString().slice(0, 10);
  await page.goto("/resources");
  await expect(page.getByLabel("Skill Tickets", { exact: true })).toHaveValue(
    String(currentEntry.resources.skillTickets),
  );
  let responseStarted!: () => void;
  let responseFinished!: () => void;
  const started = new Promise<void>((resolve) => {
    responseStarted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    responseFinished = resolve;
  });
  await page.route(`**/api/dashboard?week=${previousWeek}`, async (route) => {
    const response = await route.fetch();
    responseStarted();
    // Reproduce a slow older request arriving after a fast newer request.
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    await route.fulfill({ response });
    responseFinished();
  });
  await page
    .getByRole("button", { name: "Previous week", exact: true })
    .click();
  await started;
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(page.getByLabel("Select week", { exact: true })).toHaveValue(
    current.week,
  );
  await expect(page.getByLabel("Skill Tickets", { exact: true })).toHaveValue(
    String(currentEntry.resources.skillTickets),
  );
  await finished;
  await expect(page.getByLabel("Skill Tickets", { exact: true })).toHaveValue(
    String(currentEntry.resources.skillTickets),
  );
});
