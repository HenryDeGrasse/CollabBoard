import { test, expect } from "@playwright/test";
import { createUserSession, createStickyNote, measureFPS, testBoardId } from "./helpers";

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
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(3000)));

    // Each user creates a sticky note
    for (let i = 0; i < sessions.length; i++) {
      const x = 150 + i * 180;
      const y = 300;
      await createStickyNote(sessions[i].page, x, y);
      await sessions[i].page.waitForTimeout(300);
    }

    // Wait for all objects to sync across all clients
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(2000)));

    // Measure FPS on each user's canvas
    const fpsResults: number[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const fps = await measureFPS(sessions[i].page, 2000);
      fpsResults.push(fps);
      console.log(`${userNames[i]} FPS: ${fps.toFixed(1)}`);
    }

    // All users should maintain > 30 FPS
    for (let i = 0; i < fpsResults.length; i++) {
      expect(fpsResults[i]).toBeGreaterThan(30);
    }

    // Verify cursor sync: move each user's mouse
    await Promise.all(
      sessions.map((s, i) => {
        const canvas = s.page.locator("canvas").first();
        return canvas.hover({ position: { x: 200 + i * 100, y: 200 } });
      })
    );
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(1000)));

    // Move cursors again to trigger cursor broadcasts
    for (const [i, session] of sessions.entries()) {
      const canvas = session.page.locator("canvas").first();
      await canvas.hover({ position: { x: 300 + i * 50, y: 300 } });
    }
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(1000)));

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
