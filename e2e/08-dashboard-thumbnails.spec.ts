import { test, expect, type Page } from "@playwright/test";
import { createStickyNote } from "./helpers";

async function loginAsGuestToDashboard(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Enter your name").fill(`E2E-${Date.now()}`);
  await page.getByRole("button", { name: /Join as Guest|Join/i }).click();
  await expect(page.getByRole("button", { name: /New Board/i })).toBeVisible({ timeout: 20_000 });
}

test.describe("Dashboard thumbnails", () => {
  test("captures a board thumbnail on return to dashboard and stores JPEG in localStorage", async ({ page }) => {
    const title = `Thumb-${Date.now()}`;

    await loginAsGuestToDashboard(page);

    await page.getByRole("button", { name: /New Board/i }).click();
    await expect(page.getByText("Create New Board")).toBeVisible();
    await page.getByPlaceholder(/Board title/i).fill(title);
    await page.getByRole("button", { name: /^Create$/ }).click();

    await page.waitForURL(/\/board\//, { timeout: 20_000 });
    await expect(page.locator("canvas").first()).toBeVisible();

    const boardId = page.url().split("/board/")[1]?.split("?")[0];
    expect(boardId).toBeTruthy();

    // Put some content on canvas so thumbnail is meaningful.
    await createStickyNote(page, 320, 280);

    await page.getByRole("button", { name: /dashboard/i }).click();
    await expect(page.getByRole("button", { name: /New Board/i })).toBeVisible({ timeout: 20_000 });

    const card = page.locator("div.group").filter({ hasText: title }).first();
    await expect(card).toBeVisible();

    const thumb = card.locator("img");
    await expect(thumb).toBeVisible({ timeout: 10_000 });

    const src = await thumb.getAttribute("src");
    expect(src).toBeTruthy();
    expect(src).toContain("data:image/jpeg");

    // Regression guard: black thumbnails (transparent canvas encoded as JPEG)
    // would have near-zero average luminance.
    const avgLuma = await thumb.evaluate(async (el) => {
      const img = el as HTMLImageElement;
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      }
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || 1;
      canvas.height = img.naturalHeight || 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return 0;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      let sum = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        sum += 0.299 * r + 0.587 * g + 0.114 * b;
        count++;
      }
      return count ? sum / count : 0;
    });

    expect(avgLuma).toBeGreaterThan(20);

    const key = `collabboard-thumb-${boardId}`;
    const stored = await page.evaluate((k) => localStorage.getItem(k), key);
    expect(stored).toContain("data:image/jpeg");
  });
});
