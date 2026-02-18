import { test, expect, type Page } from "@playwright/test";

async function loginAsGuestToDashboard(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Enter your name").fill(`E2E-${Date.now()}`);
  await page.getByRole("button", { name: /Join as Guest|Join/i }).click();
  await expect(page.getByRole("button", { name: /New Board/i })).toBeVisible({ timeout: 20_000 });
}

async function createBoardFromDashboard(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: /New Board/i }).click();
  await expect(page.getByText("Create New Board")).toBeVisible();
  await page.getByPlaceholder(/Board title/i).fill(title);
  await page.getByRole("button", { name: /^Create$/ }).click();

  await page.waitForURL(/\/board\//, { timeout: 20_000 });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });

  const boardId = page.url().split("/board/")[1]?.split("?")[0];
  if (!boardId) throw new Error("Failed to parse boardId from URL");
  return boardId;
}

async function getZoomPercent(page: Page): Promise<string> {
  const zoom = page.getByText(/^\d+%$/).first();
  await expect(zoom).toBeVisible();
  return (await zoom.textContent())?.trim() || "";
}

test.describe("Viewport persistence", () => {
  test("restores zoom level when reopening a board from dashboard", async ({ page }) => {
    const title = `Viewport-${Date.now()}`;

    await loginAsGuestToDashboard(page);
    const boardId = await createBoardFromDashboard(page, title);

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas not found");

    // Move cursor over canvas and zoom in a few ticks.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(40);
    }

    const zoomBefore = await getZoomPercent(page);
    expect(zoomBefore).not.toBe("100%");

    // Return to dashboard (triggers thumbnail + unmount flush).
    await page.getByRole("button", { name: /dashboard/i }).click();
    await expect(page.getByRole("button", { name: /New Board/i })).toBeVisible({ timeout: 20_000 });

    // Reopen the same board via dashboard card.
    await page.locator("div.group").filter({ hasText: title }).first().click();
    await page.waitForURL(new RegExp(`/board/${boardId}`), { timeout: 20_000 });

    const zoomAfter = await getZoomPercent(page);
    expect(zoomAfter).toBe(zoomBefore);

    // Also verify persisted value exists in localStorage for this board.
    const storageKey = `collabboard:viewport:${boardId}`;
    const saved = await page.evaluate((k) => localStorage.getItem(k), storageKey);
    expect(saved).toBeTruthy();

    const parsed = JSON.parse(saved || "{}");
    expect(typeof parsed.scale).toBe("number");
    expect(parsed.scale).toBeGreaterThan(1);
  });
});
