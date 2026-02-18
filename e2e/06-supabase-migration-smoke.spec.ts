import { test, expect } from "@playwright/test";

type ApiError = {
  url: string;
  status: number;
  body: string;
};

function collectSupabaseErrors(page: import("@playwright/test").Page) {
  const errors: ApiError[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    const isSupabase =
      url.includes("supabase.co/rest/v1") ||
      url.includes("supabase.co/auth/v1");

    if (!isSupabase) return;
    if (response.status() < 400) return;

    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "<unavailable>";
    }

    errors.push({ url, status: response.status(), body });
  });

  return errors;
}

test.describe("Supabase migration smoke", () => {
  test("guest login -> create board -> land on board without RLS/auth errors", async ({ page }) => {
    const apiErrors = collectSupabaseErrors(page);

    await page.goto("/");

    await page.getByPlaceholder("Enter your name").fill(`E2E-${Date.now()}`);
    await page.getByRole("button", { name: /^Join$/ }).click();

    await expect(page.getByRole("button", { name: /New Board/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /New Board/i }).click();
    await expect(page.getByText("Create New Board")).toBeVisible();

    await page.getByRole("button", { name: /^Create$/ }).click();

    await page.waitForURL(/\/board\//, { timeout: 20_000 });
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

    const critical = apiErrors.filter((e) =>
      /auth\/v1\/signup|rest\/v1\/(boards|board_members|objects|connectors)/.test(e.url)
    );

    expect(
      critical,
      `Unexpected Supabase API errors:\n${JSON.stringify(critical, null, 2)}`
    ).toEqual([]);
  });
});
