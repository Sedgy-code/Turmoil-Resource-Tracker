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
  // Add missing demo fixtures rather than depending on the date of its first startup.
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
    if (data.entries.some((entry) => entry.memberId === memberId)) continue;
    const response = await request.put("/api/resources", {
      headers: { Origin: baseURL },
      data: {
        week: data.week,
        memberId,
        resources: {
          skillTickets: data.week === current.week ? 321 : 125,
          hammers: 25,
        },
        notes: "Demo browser-test fixture.",
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
    await page.getByLabel("Skill Tickets", { exact: true }).fill("54321");
    await page.getByLabel("Mythic Eggs", { exact: true }).fill("9");
    await page.getByLabel("Mythic Pets", { exact: true }).fill("7");
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
    await expect(page.getByLabel("Mythic Eggs", { exact: true })).toHaveValue(
      "9",
    );
    await expect(page.getByLabel("Mythic Pets", { exact: true })).toHaveValue(
      "7",
    );
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
    const copied = await dashboard(request);
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
    expect(csv.trim().split("\r\n")).toHaveLength(18);
    expect(csv).toContain(`Skill Tickets,${copied.totals.skillTickets}`);
    expect(csv).toContain(`Mythic Eggs,${copied.totals.eggsMythic}`);
    expect(csv).toContain(`Mythic Pets,${copied.totals.petsMythic}`);
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
        notes: ownEntry.notes,
      },
    });
    expect(restored.ok(), await restored.text()).toBeTruthy();
  }
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
  await expect(page.getByLabel("Mythic Eggs", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Mythic Pets", { exact: true })).toHaveCount(1);
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
