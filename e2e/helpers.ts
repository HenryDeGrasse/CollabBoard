import { type Page, type BrowserContext, type Browser } from "@playwright/test";

/**
 * Create a new user session: open a new browser context, navigate to the app,
 * log in as a guest with the given name, and navigate to the given board.
 */
export async function createUserSession(
  browser: Browser,
  boardId: string,
  displayName: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Go to the app
  await page.goto("/");

  // Wait for login page to load
  await page.waitForSelector('input[placeholder="Enter your name"]', {
    timeout: 10_000,
  });

  // Fill in display name and click Join (guest login)
  await page.fill('input[placeholder="Enter your name"]', displayName);
  await page.click('button:has-text("Join")');

  // Wait for login page to disappear. If it doesn't, surface auth error text.
  try {
    await page.waitForFunction(
      () => !document.querySelector('input[placeholder="Enter your name"]'),
      undefined,
      { timeout: 15_000 }
    );
  } catch {
    const authError = await page
      .locator("p.text-red-600")
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(`Guest login did not complete${authError ? `: ${authError}` : ""}`);
  }

  // Navigate to the specific board
  await page.goto(`/board/${boardId}`);

  // Wait for the Konva canvas to render
  await page.waitForSelector("canvas", { timeout: 15_000 });

  // Brief settle for Firebase subscriptions
  await page.waitForTimeout(500);

  return { context, page };
}

/**
 * Create a sticky note via the toolbar.
 * Coordinates are relative to the canvas element's top-left corner.
 */
export async function createStickyNote(
  page: Page,
  x: number,
  y: number,
  text?: string
) {
  await page.click('button:has-text("Sticky Note")');
  await page.waitForTimeout(100);

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");

  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(200);

  // Type text if provided
  if (text) {
    // Double-click to enter edit mode
    await canvas.dblclick({ position: { x, y } });
    await page.waitForTimeout(300);

    const textarea = page.locator("textarea");
    if (await textarea.isVisible({ timeout: 2000 })) {
      await textarea.fill(text);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
    }
  }
}

/**
 * Create a rectangle via the toolbar
 */
export async function createRectangle(page: Page, x: number, y: number) {
  await page.click('button:has-text("Rectangle")');
  await page.waitForTimeout(100);
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(200);
}

/**
 * Drag an object on the canvas
 */
export async function dragOnCanvas(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) return;

  await page.mouse.move(box.x + fromX, box.y + fromY);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = box.x + fromX + ((toX - fromX) * i) / steps;
    const y = box.y + fromY + ((toY - fromY) * i) / steps;
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * Measure actual Konva canvas draw rate by hooking into Stage.batchDraw.
 * Returns draws/second — a true measure of render throughput, not just
 * how fast rAF fires.  Requires window.__COLLABBOARD__.getStage() to be set.
 *
 * Falls back to an rAF counter if the stage is not yet available.
 */
export async function measureCanvasFPS(page: Page, durationMs: number = 2000): Promise<number> {
  return page.evaluate((duration) => {
    return new Promise<number>((resolve) => {
      const stage = (window as any).__COLLABBOARD__?.getStage?.();
      if (!stage || typeof stage.batchDraw !== "function") {
        // Stage not ready — fall back to rAF counter
        let frameCount = 0;
        const start = performance.now();
        const f = () => {
          frameCount++;
          if (performance.now() - start < duration) requestAnimationFrame(f);
          else resolve((frameCount / (performance.now() - start)) * 1000);
        };
        requestAnimationFrame(f);
        return;
      }

      let drawCount = 0;
      const origBatchDraw = stage.batchDraw.bind(stage);
      stage.batchDraw = function (...args: any[]) {
        drawCount++;
        return origBatchDraw(...args);
      };

      setTimeout(() => {
        stage.batchDraw = origBatchDraw;
        resolve((drawCount / duration) * 1000);
      }, duration);
    });
  }, durationMs);
}

/**
 * Generate a unique board ID for test isolation
 */
export function testBoardId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
