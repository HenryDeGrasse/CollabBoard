import { test, expect, type Page } from "@playwright/test";
import { createUserSession, testBoardId } from "./helpers";

/**
 * Test 11: End-to-end sync latency
 *
 * Measures two latency targets against their spec limits:
 *   - Object sync: < 100 ms  (time from createObject on A to visible on B)
 *   - Cursor sync: < 50 ms   (time from cursor broadcast on A to visible on B)
 *
 * Timing approach:
 *   - Both pages run in the same Chromium process on the same machine so
 *     Date.now() is synchronized.  Playwright evaluate() overhead is ~1-3 ms
 *     and is intentionally not subtracted to keep the measurement conservative.
 */

const OBJECT_SYNC_LIMIT_MS = 100;
const CURSOR_SYNC_LIMIT_MS = 50;
// Allow extra headroom in CI (network to Supabase adds RTT).
// The test prints actual latency so regressions are visible even when we stay
// under the CI limit.
const CI_EXTRA_MS = process.env.CI ? 150 : 0;

/**
 * Poll a predicate on a page, returning the Date.now() timestamp at which it
 * first returns true.  Rejects if the deadline passes without a match.
 *
 * Uses Playwright's waitForFunction which properly serializes the predicate
 * without requiring eval() or new Function().
 */
async function pollUntil(
  page: Page,
  predicate: () => boolean,
  options: { pollMs?: number; timeoutMs?: number } = {}
): Promise<number> {
  const { pollMs = 10, timeoutMs = 3000 } = options;
  // Use Playwright's built-in waitForFunction which handles serialization safely
  await page.waitForFunction(predicate, { polling: pollMs, timeout: timeoutMs });
  // Return timestamp after condition is met
  return await page.evaluate(() => Date.now());
}

test.describe("Test 11: End-to-end sync latency", () => {
  test("object sync latency is < 100 ms", async ({ browser }) => {
    const boardId = testBoardId();
    const { page: pageA } = await createUserSession(browser, boardId, "LatencyA");
    const { page: pageB } = await createUserSession(browser, boardId, "LatencyB");

    // Give realtime channels time to subscribe
    await Promise.all([pageA.waitForTimeout(800), pageB.waitForTimeout(800)]);

    // Use a unique probe marker so we only match the object we create now.
    const probeMarker = `latency-probe-${Date.now()}`;

    // Record send timestamp and fire createObject on Page A in a single evaluate
    // to minimise the gap between "recorded time" and "actual send".
    const sendTime = await pageA.evaluate((marker) => {
      const board = (window as any).__COLLABBOARD__;
      if (!board) throw new Error("__COLLABBOARD__ not on window");
      const t = Date.now();
      board.createObject({
        type: "sticky",
        x: 500, y: 500,
        width: 100, height: 100,
        color: "#FBBF24",
        text: marker,
        rotation: 0,
        zIndex: 1,
        createdBy: board.userId || "test",
        parentFrameId: null,
      });
      return t;
    }, probeMarker);

    // Poll on Page B until the probe object appears in its local objects map.
    const receiveTime = await pollUntil(
      pageB,
      () => {
        const objs = (window as any).__COLLABBOARD__?.objects ?? {};
        return Object.values(objs).some(
          (o: any) => typeof o.text === "string" && o.text.includes("latency-probe-")
        );
      },
      { timeoutMs: 3000 }
    );

    const latencyMs = receiveTime - sendTime;
    console.log(`Object sync latency: ${latencyMs} ms  (target < ${OBJECT_SYNC_LIMIT_MS} ms)`);

    expect(latencyMs).toBeLessThan(OBJECT_SYNC_LIMIT_MS + CI_EXTRA_MS);
  });

  test("cursor sync latency is < 50 ms", async ({ browser }) => {
    const boardId = testBoardId();
    const { page: pageA } = await createUserSession(browser, boardId, "CursorA");
    const { page: pageB } = await createUserSession(browser, boardId, "CursorB");

    // Wait for presence channel to be fully subscribed on both sides.
    await Promise.all([pageA.waitForTimeout(1200), pageB.waitForTimeout(1200)]);

    // Get User A's userId so Page B knows which cursor to watch for.
    const userAId = await pageA.evaluate(() => (window as any).__COLLABBOARD__?.userId ?? "");
    expect(userAId).not.toBe("");

    // Move User A's mouse to an initial position to confirm the channel is hot.
    const canvasBox = await pageA.locator("canvas").first().boundingBox();
    if (!canvasBox) throw new Error("canvas not found");

    // Warm-up: move to initial position and wait for User B to see it.
    await pageA.mouse.move(canvasBox.x + 200, canvasBox.y + 200);
    await pageB.waitForFunction(
      (uid) => {
        const positions = (window as any).__COLLABBOARD__?.getCursorPositions?.() ?? {};
        return !!positions[uid];
      },
      userAId,
      { timeout: 3000 }
    );

    // ── Actual latency measurement ──
    // Move to a sentinel canvas position, then poll Page B for the update.
    // We fire the move and start the poll in parallel via Promise.all to avoid
    // serialised Playwright call overhead inflating the measurement.

    // Choose a sentinel canvas coordinate that's unlikely to be the current position.
    const SENTINEL_X = canvasBox.x + 387;
    const SENTINEL_Y = canvasBox.y + 291;

    const [sendTime, receiveTime] = await Promise.all([
      // Record time immediately before the mouse move on Page A
      pageA.evaluate(() => Date.now()),
      // Start polling on Page B for any cursor movement from User A
      (async () => {
        // Snapshot the current cursor position on Page B so we detect a change
        const prevPos = await pageB.evaluate((uid) => {
          const p = (window as any).__COLLABBOARD__?.getCursorPositions?.() ?? {};
          return p[uid] ? { x: p[uid].x, y: p[uid].y } : null;
        }, userAId);

        // Move User A's mouse (this triggers the cursor broadcast)
        await pageA.mouse.move(SENTINEL_X, SENTINEL_Y);

        // Poll Page B until User A's cursor has moved from the previous position
        return pollUntil(
          pageB,
          () => {
            const positions = (window as any).__COLLABBOARD__?.getCursorPositions?.() ?? {};
            const cur = positions[userAId];
            if (!cur) return false;
            // Detect movement rather than an exact pixel match (viewport scale varies)
            if (!prevPos) return true;
            return Math.abs(cur.x - prevPos.x) > 1 || Math.abs(cur.y - prevPos.y) > 1;
          },
          { pollMs: 5, timeoutMs: 3000 }
        );
      })(),
    ]);

    const latencyMs = receiveTime - sendTime;
    console.log(`Cursor sync latency: ${latencyMs} ms  (target < ${CURSOR_SYNC_LIMIT_MS} ms)`);

    expect(latencyMs).toBeLessThan(CURSOR_SYNC_LIMIT_MS + CI_EXTRA_MS);
  });
});
