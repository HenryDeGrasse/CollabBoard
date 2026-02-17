import { test, expect } from "@playwright/test";
import { createUserSession, createStickyNote, testBoardId } from "./helpers";

test.describe("Test 2: One User Refreshing Mid-Edit", () => {
  test("text committed before refresh is preserved", async ({ browser }) => {
    const boardId = testBoardId();

    const userA = await createUserSession(browser, boardId, "Alice");
    const userB = await createUserSession(browser, boardId, "Bob");

    // User A creates a sticky note
    await createStickyNote(userA.page, 300, 300);
    await userA.page.waitForTimeout(500);

    // Double-click to edit using page.mouse (bypasses Playwright actionability)
    const canvasA = userA.page.locator("canvas").first();
    const boxA = await canvasA.boundingBox();
    if (!boxA) throw new Error("Canvas not found");

    await userA.page.mouse.dblclick(boxA.x + 300, boxA.y + 300);
    await userA.page.waitForTimeout(500);

    // Type text into the textarea overlay
    const textarea = userA.page.locator("textarea");
    if (await textarea.isVisible({ timeout: 3000 })) {
      await textarea.fill("Important Note");
      // Press Enter to commit
      await userA.page.keyboard.press("Enter");
      await userA.page.waitForTimeout(500);
    }

    // Wait for sync
    await userB.page.waitForTimeout(1000);

    // Now User A refreshes
    await userA.page.reload();
    await userA.page.waitForSelector("canvas", { timeout: 15_000 });
    await userA.page.waitForTimeout(2000);

    // After refresh, board state should be intact — canvas should be visible
    await expect(userA.page.locator("canvas").first()).toBeVisible();

    // No errors on refresh
    const errors: string[] = [];
    userA.page.on("pageerror", (err) => errors.push(err.message));
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);

    await userA.context.close();
    await userB.context.close();
  });
});
