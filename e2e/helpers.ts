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

  // Login as guest
  await page.waitForSelector('input[placeholder*="name" i], input[placeholder*="Name" i]', {
    timeout: 10_000,
  });
  await page.fill('input[placeholder*="name" i], input[placeholder*="Name" i]', displayName);
  await page.click('button:has-text("Guest"), button:has-text("guest"), button:has-text("Anonymous"), button:has-text("Continue")');

  // Wait for redirect to home page or board
  await page.waitForURL(/\/(board\/|$)/, { timeout: 10_000 });

  // Navigate to the specific board
  await page.goto(`/board/${boardId}`);
  await page.waitForSelector("canvas, [data-testid='canvas']", { timeout: 10_000 });

  // Give a moment for Firebase subscriptions to settle
  await page.waitForTimeout(1000);

  return { context, page };
}

/**
 * Create a sticky note via the toolbar
 */
export async function createStickyNote(
  page: Page,
  x: number,
  y: number,
  text?: string
) {
  // Click the sticky note tool (shortcut S)
  await page.keyboard.press("s");
  await page.waitForTimeout(200);

  // Click on canvas at position
  const canvas = page.locator("canvas").first();
  await canvas.click({ position: { x, y } });
  await page.waitForTimeout(300);

  // Type text if provided
  if (text) {
    await page.keyboard.press("Enter"); // or double-click to edit
    // Actually, new sticky should be auto-selected, double-click to edit
    await canvas.dblclick({ position: { x, y } });
    await page.waitForTimeout(200);
    await page.keyboard.type(text);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
}

/**
 * Create a rectangle via the toolbar
 */
export async function createRectangle(page: Page, x: number, y: number) {
  await page.keyboard.press("r");
  await page.waitForTimeout(200);
  const canvas = page.locator("canvas").first();
  await canvas.click({ position: { x, y } });
  await page.waitForTimeout(300);
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
  await canvas.hover({ position: { x: fromX, y: fromY } });
  await page.mouse.down();
  // Move in small steps for smoother drag
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps;
    const y = fromY + ((toY - fromY) * i) / steps;
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * Measure FPS over a duration using requestAnimationFrame
 */
export async function measureFPS(page: Page, durationMs: number = 2000): Promise<number> {
  return page.evaluate((duration) => {
    return new Promise<number>((resolve) => {
      let frameCount = 0;
      const start = performance.now();

      function frame() {
        frameCount++;
        if (performance.now() - start < duration) {
          requestAnimationFrame(frame);
        } else {
          const elapsed = performance.now() - start;
          resolve((frameCount / elapsed) * 1000);
        }
      }

      requestAnimationFrame(frame);
    });
  }, durationMs);
}

/**
 * Count objects visible on the board by querying Firebase state via the page context
 */
export async function getObjectCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    // Count Konva shapes on the canvas (excluding grid, selection, cursors)
    const stage = (window as any).Konva?.stages?.[0];
    if (!stage) return 0;
    const layer = stage.getLayers()[0];
    if (!layer) return 0;
    return layer.getChildren().length;
  });
}

/**
 * Generate a unique board ID for test isolation
 */
export function testBoardId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
