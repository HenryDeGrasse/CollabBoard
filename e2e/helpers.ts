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

  // Fill in display name and click Continue as Guest
  await page.fill('input[placeholder="Enter your name"]', displayName);
  await page.click('button:has-text("Continue as Guest")');

  // Wait for auth to complete and redirect — could go to home page or stay
  // The app creates a board or we navigate to one
  await page.waitForTimeout(2000);

  // Navigate to the specific board
  await page.goto(`/board/${boardId}`);

  // Wait for the Konva canvas to render
  await page.waitForSelector("canvas", { timeout: 15_000 });

  // Give Firebase subscriptions time to settle
  await page.waitForTimeout(1500);

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
  // Click the Sticky Note button in toolbar directly (more reliable than keyboard)
  await page.click('button:has-text("Sticky Note")');
  await page.waitForTimeout(300);

  // Click on canvas at position using mouse events for Konva compatibility
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");

  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(500);

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
  await page.waitForTimeout(300);
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(500);
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
 * Generate a unique board ID for test isolation
 */
export function testBoardId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
