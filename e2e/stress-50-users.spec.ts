import { test, expect } from "@playwright/test";
import { createUserSession, createStickyNote, measureCanvasFPS, testBoardId } from "./helpers";

/**
 * Stress Test: 5 concurrent browsers + 1000 objects
 *
 * Uses window.__COLLABBOARD__.createObjects (batch API) to insert objects
 * in a single DB round-trip per browser instead of N individual calls.
 */

async function bulkCreateObjects(page: any, count: number, startIdx: number) {
  await page.evaluate(
    ({ count, startIdx }: { count: number; startIdx: number }) => {
      const board = (window as any).__COLLABBOARD__;
      if (!board) throw new Error("__COLLABBOARD__ not found on window");

      const colors = ["#FBBF24", "#F472B6", "#3B82F6", "#22C55E", "#F97316", "#A855F7"];
      const types: Array<"sticky" | "rectangle" | "circle"> = ["sticky", "rectangle", "circle"];

      const objs = [];
      for (let i = 0; i < count; i++) {
        objs.push({
          type: types[i % types.length],
          x: 50 + ((startIdx + i) % 25) * 100,
          y: 50 + Math.floor((startIdx + i) / 25) * 100,
          width: 80,
          height: 80,
          color: colors[i % colors.length],
          text: `#${startIdx + i + 1}`,
          rotation: 0,
          zIndex: startIdx + i,
          createdBy: `stress-user`,
        });
      }

      // createObjects is the batch API — single DB round-trip per chunk of 200
      return board.createObjects(objs);
    },
    { count, startIdx }
  );
}

test.describe("Stress Test: 50 Users + 1000 Objects", () => {
  test("5 browser users + 1000 objects maintain 60 FPS", async ({ browser }) => {
    test.setTimeout(300_000);

    const boardId = testBoardId();
    const sessions: Awaited<ReturnType<typeof createUserSession>>[] = [];

    console.log("Creating 5 browser sessions...");
    for (let i = 0; i < 5; i++) {
      const session = await createUserSession(browser, boardId, `BrowserUser${i + 1}`);
      sessions.push(session);
    }

    await Promise.all(sessions.map((s) => s.page.waitForTimeout(800)));

    // Phase 1: Create 1000 objects (200 per browser, in parallel)
    console.log("Creating 1000 objects (200 per browser via app API)...");
    await Promise.all(
      sessions.map((session, idx) => bulkCreateObjects(session.page, 200, idx * 200))
    );

    console.log("All 1000 objects created. Waiting for sync...");
    await Promise.all(sessions.map((s) => s.page.waitForTimeout(2000)));

    // Phase 2: Measure canvas draw rate
    console.log("Measuring canvas FPS on all 5 browser sessions...");
    const fpsResults: number[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const fps = await measureCanvasFPS(sessions[i].page, 3000);
      fpsResults.push(fps);
      console.log(`BrowserUser${i + 1} canvas FPS with 1000 objects: ${fps.toFixed(1)}`);
    }

    for (let i = 0; i < fpsResults.length; i++) {
      expect(fpsResults[i]).toBeGreaterThan(60);
    }

    // Phase 3: UI interaction under load
    console.log("Testing UI interaction under load...");
    await createStickyNote(sessions[0].page, 400, 400);
    await sessions[0].page.waitForTimeout(500);

    // Phase 4: Pan and zoom
    const page0 = sessions[0].page;
    const canvas0 = page0.locator("canvas").first();
    const box0 = await canvas0.boundingBox();
    if (box0) {
      await page0.mouse.move(box0.x + 400, box0.y + 400);
      await page0.keyboard.down("Space");
      await page0.mouse.down();
      await page0.mouse.move(box0.x + 200, box0.y + 200, { steps: 10 });
      await page0.mouse.up();
      await page0.keyboard.up("Space");
      await page0.waitForTimeout(500);

      for (let i = 0; i < 5; i++) {
        await page0.mouse.wheel(0, -100);
        await page0.waitForTimeout(100);
      }
      await page0.waitForTimeout(500);
    }

    const fpsAfterInteraction = await measureCanvasFPS(page0, 2000);
    console.log(`Canvas FPS after pan/zoom: ${fpsAfterInteraction.toFixed(1)}`);
    expect(fpsAfterInteraction).toBeGreaterThan(60);

    // Summary
    const avgFps = fpsResults.reduce((a, b) => a + b, 0) / fpsResults.length;
    console.log("\n=== STRESS TEST SUMMARY ===");
    console.log(`Board: ${boardId}`);
    console.log(`Objects: 1000`);
    console.log(`Users: 5 real browsers`);
    console.log(`Avg FPS: ${avgFps.toFixed(1)}`);
    console.log(`Min FPS: ${Math.min(...fpsResults).toFixed(1)}`);
    console.log(`FPS after interaction: ${fpsAfterInteraction.toFixed(1)}`);
    console.log("===========================\n");

    for (const session of sessions) {
      await session.context.close();
    }
  });
});
