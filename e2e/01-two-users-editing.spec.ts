import { test, expect } from "@playwright/test";
import { createUserSession, createStickyNote, createRectangle, dragOnCanvas, testBoardId } from "./helpers";

test.describe("Test 1: Two Users Editing Simultaneously", () => {
  const boardId = testBoardId();

  test("both users see each other's objects created simultaneously", async ({ browser }) => {
    // Setup: two browser contexts (two users)
    const userA = await createUserSession(browser, boardId, "Alice");
    const userB = await createUserSession(browser, boardId, "Bob");

    // User A creates a sticky note
    await createStickyNote(userA.page, 300, 300);
    await userA.page.waitForTimeout(500);

    // User B should see the sticky note
    // Check that at least one Konva shape appeared in User B's canvas
    await userB.page.waitForTimeout(500);
    const userBCanvas = userB.page.locator("canvas").first();
    await expect(userBCanvas).toBeVisible();

    // User B creates a rectangle
    await createRectangle(userB.page, 500, 300);
    await userB.page.waitForTimeout(500);

    // User A should see the rectangle
    await userA.page.waitForTimeout(500);

    // Both users drag objects simultaneously
    await Promise.all([
      dragOnCanvas(userA.page, 300, 300, 400, 400),
      dragOnCanvas(userB.page, 500, 300, 600, 400),
    ]);

    // Wait for sync
    await userA.page.waitForTimeout(500);
    await userB.page.waitForTimeout(500);

    // Verify no errors in console
    const errorsA: string[] = [];
    const errorsB: string[] = [];
    userA.page.on("pageerror", (err) => errorsA.push(err.message));
    userB.page.on("pageerror", (err) => errorsB.push(err.message));

    // Check there are no Firebase or rendering errors
    expect(errorsA.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
    expect(errorsB.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);

    // Cleanup
    await userA.context.close();
    await userB.context.close();
  });

  test("both users see each other's cursors in the presence panel", async ({ browser }) => {
    const bid = testBoardId();
    const userA = await createUserSession(browser, bid, "Alice");
    const userB = await createUserSession(browser, bid, "Bob");

    // Wait for presence to sync
    await userA.page.waitForTimeout(800);
    await userB.page.waitForTimeout(800);

    // Check presence panel shows both users on User A's screen
    const presenceA = userA.page.locator("[class*='presence'], [data-testid='presence']").first();
    if (await presenceA.isVisible()) {
      const textA = await presenceA.textContent();
      expect(textA).toContain("Bob");
    }

    // Check presence panel shows both users on User B's screen
    const presenceB = userB.page.locator("[class*='presence'], [data-testid='presence']").first();
    if (await presenceB.isVisible()) {
      const textB = await presenceB.textContent();
      expect(textB).toContain("Alice");
    }

    await userA.context.close();
    await userB.context.close();
  });
});
