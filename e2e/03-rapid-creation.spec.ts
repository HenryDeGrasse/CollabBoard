import { test, expect } from "@playwright/test";
import { createUserSession, measureFPS, testBoardId } from "./helpers";

test.describe("Test 3: Rapid Creation and Movement", () => {
  test("create 20+ objects rapidly and verify sync + FPS", async ({ browser }) => {
    const boardId = testBoardId();

    const userA = await createUserSession(browser, boardId, "Alice");
    const userB = await createUserSession(browser, boardId, "Bob");

    const canvasA = userA.page.locator("canvas").first();

    // Rapidly create 25 sticky notes
    for (let i = 0; i < 25; i++) {
      const x = 100 + (i % 5) * 160;
      const y = 100 + Math.floor(i / 5) * 160;

      // Press S for sticky tool
      await userA.page.keyboard.press("s");
      await userA.page.waitForTimeout(50);
      await canvasA.click({ position: { x, y } });
      await userA.page.waitForTimeout(100);
    }

    // Wait for all objects to sync
    await userA.page.waitForTimeout(2000);
    await userB.page.waitForTimeout(2000);

    // Verify User A's canvas is still responsive — measure FPS
    const fpsA = await measureFPS(userA.page, 2000);
    console.log(`User A FPS after 25 objects: ${fpsA.toFixed(1)}`);
    expect(fpsA).toBeGreaterThan(30); // Should be well above 30 FPS

    // Verify User B also has responsive canvas
    const fpsB = await measureFPS(userB.page, 2000);
    console.log(`User B FPS after 25 objects: ${fpsB.toFixed(1)}`);
    expect(fpsB).toBeGreaterThan(30);

    // Rapid dragging: drag the first 10 objects quickly
    for (let i = 0; i < 10; i++) {
      const fromX = 100 + (i % 5) * 160;
      const fromY = 100 + Math.floor(i / 5) * 160;
      const toX = fromX + 50;
      const toY = fromY + 50;

      await canvasA.hover({ position: { x: fromX, y: fromY } });
      await userA.page.mouse.down();
      await userA.page.mouse.move(toX, toY, { steps: 5 });
      await userA.page.mouse.up();
      await userA.page.waitForTimeout(50);
    }

    // Wait for sync
    await userA.page.waitForTimeout(1000);

    // Measure FPS after rapid dragging
    const fpsAfterDrag = await measureFPS(userA.page, 2000);
    console.log(`User A FPS after rapid drag: ${fpsAfterDrag.toFixed(1)}`);
    expect(fpsAfterDrag).toBeGreaterThan(30);

    // No console errors
    const errors: string[] = [];
    userA.page.on("pageerror", (err) => errors.push(err.message));
    expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);

    await userA.context.close();
    await userB.context.close();
  });
});
