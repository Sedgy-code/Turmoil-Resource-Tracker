import { existsSync } from "node:fs";
import { test, expect } from "@playwright/test";

// Read-only smoke checks for a built, non-demo instance without OAuth credentials.
// Start it on a separate port; these tests never write application data.
const baseURL =
  process.env.PLAYWRIGHT_PROTECTED_BASE_URL || "http://localhost:3001";
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
test.use({
  baseURL,
  browserName: "chromium",
  launchOptions: { executablePath },
});
test.setTimeout(60_000);

test.beforeAll(async ({ request }) => {
  const response = await request.get("/api/session");
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  expect(session.demo).toBe(false);
  expect(session.user).toBe(null);
  test.skip(
    session.configured,
    "This smoke check expects an unconfigured non-demo instance.",
  );
});

test("every unauthenticated browser route shows the Discord login screen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of ["/", "/resources", "/members", "/weeks"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "One clan. Endless potential." }),
    ).toBeVisible();
    await expect(
      page.getByText("Continue with Discord", { exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByText("Discord login is awaiting configuration.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByText("Continue with Discord", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test("protected APIs deny unauthenticated reads and writes without touching the database", async ({
  request,
}) => {
  for (const path of ["/api/dashboard", "/api/weeks", "/api/members"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in with Discord to access the tracker.",
      code: "UNAUTHENTICATED",
    });
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
  const origin =
    process.env.PLAYWRIGHT_PROTECTED_APP_ORIGIN ||
    "https://tracker.example.com";
  for (const [method, path] of [
    ["PUT", "/api/resources"],
    ["POST", "/api/resources/copy"],
    ["PATCH", "/api/members/00000000-0000-4000-8000-000000000000"],
  ] as const) {
    const response = await request.fetch(path, {
      method,
      headers: { Origin: origin },
      data: {},
    });
    expect(response.status()).toBe(401);
    expect((await response.json()).code).toBe("UNAUTHENTICATED");
    const foreignOrigin = await request.fetch(path, {
      method,
      headers: { Origin: "https://untrusted.example" },
      data: {},
    });
    expect(foreignOrigin.status()).toBe(403);
    expect((await foreignOrigin.json()).code).toBe("INVALID_ORIGIN");
  }
  const login = await request.get("/api/auth/login", { maxRedirects: 0 });
  expect(login.status()).toBe(503);
  expect((await login.json()).code).toBe("AUTH_NOT_CONFIGURED");
  expect(login.headers()["set-cookie"]).toBeUndefined();
});
