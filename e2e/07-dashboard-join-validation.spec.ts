import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function loginAsGuestToDashboard(page: import("@playwright/test").Page) {
  await page.goto("/");

  await page.getByPlaceholder("Enter your name").fill(`E2E-${Date.now()}`);
  await page.getByRole("button", { name: /Join as Guest|Join/i }).click();

  await expect(page.getByRole("button", { name: /New Board/i })).toBeVisible({ timeout: 20_000 });
}

test.describe("Dashboard join board validation", () => {
  test("shows not-found toast for malformed board IDs", async ({ page }) => {
    await loginAsGuestToDashboard(page);

    await page.getByPlaceholder("Board ID").fill("not-a-uuid");
    await page.getByRole("button", { name: /^Join$/ }).click();

    const toast = page.getByText("Board not found — double-check the ID and try again.");
    await expect(toast).toBeVisible();

    // Should remain on dashboard (no board navigation)
    await expect(page).not.toHaveURL(/\/board\//);

    // Toast auto-dismisses after 3s
    await expect(toast).toBeHidden({ timeout: 6_000 });
  });

  test("shows same not-found toast for well-formed but missing UUID", async ({ page }) => {
    await loginAsGuestToDashboard(page);

    await page.getByPlaceholder("Board ID").fill(randomUUID());
    await page.getByRole("button", { name: /^Join$/ }).click();

    await expect(page.getByText("Board not found — double-check the ID and try again.")).toBeVisible();
    await expect(page).not.toHaveURL(/\/board\//);
  });
});
