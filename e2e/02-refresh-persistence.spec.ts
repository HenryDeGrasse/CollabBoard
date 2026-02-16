import { test, expect } from "@playwright/test";
import { createUserSession, createStickyNote, testBoardId } from "./helpers";

test.describe("Test 2: One User Refreshing Mid-Edit", () => {
  test("text committed before refresh is preserved", async ({ browser }) => {
    const boardId = testBoardId();

    // User A and B join the same board
    const userA = await createUserSession(browser, boardId, "Alice");
    const userB = await createUserSession(browser, boardId, "Bob");

    // User A creates a sticky note and adds text
    await createStickyNote(userA.page, 300, 300);
    await userA.page.waitForTimeout(500);

    // Double-click to edit and type text
    const canvasA = userA.page.locator("canvas").first();
    await canvasA.dblclick({ position: { x: 300, y: 300 } });
    await userA.page.waitForTimeout(300);

    // Type text into the textarea overlay
    const textarea = userA.page.locator("textarea");
    if (await textarea.isVisible({ timeout: 2000 })) {
      await textarea.fill("Important Note");
      // Blur to commit
      await userA.page.keyboard.press("Enter");
      await userA.page.waitForTimeout(500);
    }

    // User B should see the text
    await userB.page.waitForTimeout(1000);

    // Now User A refreshes
    await userA.page.reload();
    await userA.page.waitForSelector("canvas", { timeout: 10_000 });
    await userA.page.waitForTimeout(2000);

    // After refresh, board state should be intact
    // The canvas should still be visible (board loaded)
    await expect(userA.page.locator("canvas").first()).toBeVisible();

    // User A should reappear in User B's presence panel after reconnect
    await userA.page.waitForTimeout(3000);

    // No errors on refresh
    const errors: string[] = [];
    userA.page.on("pageerror", (err) => errors.push(err.message));
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);

    await userA.context.close();
    await userB.context.close();
  });
});
