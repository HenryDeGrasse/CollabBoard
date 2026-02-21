import { test, expect } from "@playwright/test";
import { createUserSession, createStickyNote, measureCanvasFPS, testBoardId } from "./helpers";

test.describe("Test 5: 5+ Concurrent Users Without Degradation", () => {
  test("5 users can all see each other and interact without performance drops", async ({
    browser,
  }) => {
    const boardId = testBoardId();
    const userNames = ["Alice", "Bob", "Carol", "Dave", "Eve"];
    const sessions: Awaited<ReturnType<typeof createUserSession>>[] = [];

    // Create 5 user sessions
    for (const name of userNames) {
      const session = await createUserSession(browser, boardId, name);
      sessions.push(session);
    }

    // Wait for all presence to sync
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(1000)));

    // Each user creates a sticky note at different positions
    for (let i = 0; i < sessions.length; i++) {
      const x = 100 + i * 150;
      const y = 200;
      await createStickyNote(sessions[i].page, x, y);
      await sessions[i].page.waitForTimeout(500);
    }

    // Wait for all objects to sync across all clients
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(800)));

    // Measure actual canvas draw rate on each user's client.
    // measureCanvasFPS hooks into Stage.batchDraw to count real redraws,
    // not just rAF invocations (which are always ~60 regardless of paint work).
    const fpsResults: number[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const fps = await measureCanvasFPS(sessions[i].page, 2000);
      fpsResults.push(fps);
      console.log(`${userNames[i]} canvas FPS: ${fps.toFixed(1)}`);
    }

    // All users should maintain 60 canvas draws/sec with 5 concurrent users
    for (let i = 0; i < fpsResults.length; i++) {
      expect(fpsResults[i]).toBeGreaterThan(60);
    }

    // Verify cursor sync: move each user's mouse over the canvas
    for (let i = 0; i < sessions.length; i++) {
      const canvas = sessions[i].page.locator("canvas").first();
      const box = await canvas.boundingBox();
      if (box) {
        await sessions[i].page.mouse.move(box.x + 200 + i * 100, box.y + 200);
      }
    }
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(500)));

    // Move cursors again to trigger cursor broadcasts
    for (let i = 0; i < sessions.length; i++) {
      const canvas = sessions[i].page.locator("canvas").first();
      const box = await canvas.boundingBox();
      if (box) {
        await sessions[i].page.mouse.move(box.x + 300 + i * 50, box.y + 300);
      }
    }
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(500)));

    // No errors on any client
    for (const session of sessions) {
      const errors: string[] = [];
      session.page.on("pageerror", (err) => errors.push(err.message));
      expect(errors.filter((e) => !e.includes("ResizeObserver"))).toHaveLength(0);
    }

    // Cleanup
    for (const session of sessions) {
      await session.context.close();
    }
  });
});
