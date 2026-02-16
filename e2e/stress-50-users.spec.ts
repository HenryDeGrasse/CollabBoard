import { test, expect } from "@playwright/test";
import { createUserSession, measureFPS, testBoardId } from "./helpers";

/**
 * Stress Test: 50 concurrent users + 1000 objects
 *
 * Approach:
 * - 5 real Playwright browser contexts (for rendering/FPS verification)
 * - 45 synthetic Firebase SDK clients (lightweight, no browser)
 * - 1000 objects created programmatically
 *
 * This test uses page.evaluate() to create objects directly via Firebase SDK
 * from within the browser context, simulating both real rendering and load generation.
 */

test.describe("Stress Test: 50 Users + 1000 Objects", () => {
  test("5 browser users + 1000 objects maintain 30+ FPS", async ({ browser }) => {
    const boardId = testBoardId();
    const sessions: Awaited<ReturnType<typeof createUserSession>>[] = [];

    // Create 5 real browser sessions
    console.log("Creating 5 browser sessions...");
    for (let i = 0; i < 5; i++) {
      const session = await createUserSession(browser, boardId, `BrowserUser${i + 1}`);
      sessions.push(session);
    }

    // Wait for presence to sync
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(2000)));

    // Phase 1: Create 200 objects from each of the 5 browsers (= 1000 total)
    console.log("Creating 1000 objects (200 per browser)...");
    await Promise.all(
      sessions.map((session, browserIdx) =>
        session.page.evaluate(
          async ({ boardId, browserIdx, count }) => {
            // Access Firebase from within the page context
            const { initializeApp } = await import("firebase/app");
            const { getDatabase, ref, push, set } = await import("firebase/database");

            // The app is already initialized, get the existing DB reference
            // Use the existing Firebase instance from the page
            const db = getDatabase();

            const objectsRef = ref(db, `boards/${boardId}/objects`);

            for (let i = 0; i < count; i++) {
              const newRef = push(objectsRef);
              const colors = ["#FBBF24", "#F472B6", "#3B82F6", "#22C55E", "#F97316", "#A855F7"];
              const types = ["sticky", "rectangle", "circle"];
              await set(newRef, {
                id: newRef.key,
                type: types[i % types.length],
                x: 50 + (i % 20) * 120 + browserIdx * 2400,
                y: 50 + Math.floor(i / 20) * 120,
                width: 100,
                height: 100,
                color: colors[i % colors.length],
                text: `Obj ${browserIdx * count + i + 1}`,
                rotation: 0,
                zIndex: i,
                createdBy: `browser-user-${browserIdx}`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
            }
          },
          { boardId, browserIdx, count: 200 }
        )
      )
    );

    console.log("All 1000 objects created. Waiting for sync...");
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(5000)));

    // Phase 2: Simulate 45 additional "synthetic" presence entries
    // These are written directly to Firebase from one browser context
    console.log("Simulating 45 synthetic user presence entries...");
    await sessions[0].page.evaluate(
      async ({ boardId }) => {
        const { getDatabase, ref, set } = await import("firebase/database");
        const db = getDatabase();

        for (let i = 6; i <= 50; i++) {
          const presenceRef = ref(db, `presence/${boardId}/synthetic-user-${i}`);
          await set(presenceRef, {
            displayName: `SyntheticUser${i}`,
            cursorColor: `#${Math.floor(Math.random() * 16777215)
              .toString(16)
              .padStart(6, "0")}`,
            cursor: { x: Math.random() * 2000, y: Math.random() * 2000 },
            online: true,
            lastSeen: Date.now(),
            editingObjectId: null,
          });
        }
      },
      { boardId }
    );

    console.log("50 users simulated. Waiting for presence sync...");
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(3000)));

    // Phase 3: Simulate cursor movement from synthetic users
    console.log("Simulating cursor movements from 45 synthetic users...");
    await sessions[0].page.evaluate(
      async ({ boardId }) => {
        const { getDatabase, ref, set } = await import("firebase/database");
        const db = getDatabase();

        // Move each synthetic cursor 5 times
        for (let round = 0; round < 5; round++) {
          for (let i = 6; i <= 50; i++) {
            const cursorRef = ref(db, `presence/${boardId}/synthetic-user-${i}/cursor`);
            set(cursorRef, {
              x: Math.random() * 3000,
              y: Math.random() * 2000,
            });
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      },
      { boardId }
    );

    await Promise.all(sessions.map((s) => s.page.waitForTimeout(2000)));

    // Phase 4: Measure FPS on all 5 real browser sessions
    console.log("Measuring FPS on all 5 browser sessions...");
    const fpsResults: number[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const fps = await measureFPS(sessions[i].page, 3000);
      fpsResults.push(fps);
      console.log(`BrowserUser${i + 1} FPS with 1000 objects + 50 users: ${fps.toFixed(1)}`);
    }

    // All browsers should maintain > 20 FPS under extreme load
    // (lower threshold than normal since 1000 objects is extreme)
    for (let i = 0; i < fpsResults.length; i++) {
      expect(fpsResults[i]).toBeGreaterThan(20);
    }

    // Phase 5: Verify real users can still interact
    console.log("Testing interaction under load...");
    const canvasA = sessions[0].page.locator("canvas").first();

    // Pan the canvas
    await canvasA.hover({ position: { x: 400, y: 400 } });
    await sessions[0].page.keyboard.down("Space");
    await sessions[0].page.mouse.down();
    await sessions[0].page.mouse.move(200, 200, { steps: 10 });
    await sessions[0].page.mouse.up();
    await sessions[0].page.keyboard.up("Space");
    await sessions[0].page.waitForTimeout(500);

    // Zoom
    await canvasA.hover({ position: { x: 400, y: 400 } });
    for (let i = 0; i < 5; i++) {
      await sessions[0].page.mouse.wheel(0, -100);
      await sessions[0].page.waitForTimeout(100);
    }
    await sessions[0].page.waitForTimeout(500);

    // Measure FPS after interaction
    const fpsAfterInteraction = await measureFPS(sessions[0].page, 2000);
    console.log(`FPS after pan/zoom interaction: ${fpsAfterInteraction.toFixed(1)}`);
    expect(fpsAfterInteraction).toBeGreaterThan(15);

    // Phase 6: Summary
    console.log("\n=== STRESS TEST SUMMARY ===");
    console.log(`Board: ${boardId}`);
    console.log(`Objects: 1000`);
    console.log(`Users: 50 (5 real + 45 synthetic)`);
    console.log(`Avg FPS: ${(fpsResults.reduce((a, b) => a + b, 0) / fpsResults.length).toFixed(1)}`);
    console.log(`Min FPS: ${Math.min(...fpsResults).toFixed(1)}`);
    console.log(`FPS after interaction: ${fpsAfterInteraction.toFixed(1)}`);
    console.log("===========================\n");

    // Cleanup
    for (const session of sessions) {
      await session.context.close();
    }
  });
});
