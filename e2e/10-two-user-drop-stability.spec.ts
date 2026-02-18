import { test, expect, type Page } from "@playwright/test";
import { createUserSession, createStickyNote, testBoardId } from "./helpers";

async function dragQuick(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not found");

  await page.mouse.move(box.x + fromX, box.y + fromY);
  await page.mouse.down();

  const steps = 4; // intentionally quick drop
  for (let i = 1; i <= steps; i++) {
    const x = box.x + fromX + ((toX - fromX) * i) / steps;
    const y = box.y + fromY + ((toY - fromY) * i) / steps;
    await page.mouse.move(x, y);
    await page.waitForTimeout(12);
  }

  await page.mouse.up();
}

async function sampleCanvasCentroids(
  page: Page,
  durationMs: number,
  intervalMs: number
): Promise<Array<{ t: number; x: number; y: number; pixels: number }>> {
  return page.evaluate(
    async ({ duration, interval }) => {
      const points: Array<{ t: number; x: number; y: number; pixels: number }> = [];
      const start = performance.now();

      const centroidForCanvas = (canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        const { width, height } = canvas;
        if (!width || !height) return null;

        const data = ctx.getImageData(0, 0, width, height).data;

        let sx = 0;
        let sy = 0;
        let n = 0;

        // Konva object layer is transparent where no object exists.
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 10) continue;
          const idx = i / 4;
          sx += idx % width;
          sy += Math.floor(idx / width);
          n++;
        }

        if (n === 0) return null;
        return { x: sx / n, y: sy / n, pixels: n };
      };

      const sampleBestCentroid = () => {
        const canvases = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
        let best: { x: number; y: number; pixels: number } | null = null;
        for (const c of canvases) {
          const cur = centroidForCanvas(c);
          if (!cur) continue;
          if (!best || cur.pixels > best.pixels) best = cur;
        }
        return best;
      };

      while (performance.now() - start < duration) {
        const c = sampleBestCentroid();
        if (c) points.push({ t: performance.now() - start, ...c });
        await new Promise((r) => setTimeout(r, interval));
      }

      return points;
    },
    { duration: durationMs, interval: intervalMs }
  );
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const arr = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

test.describe("Two-user drop stability", () => {
  test("collaborator view does not snap back after quick drop", async ({ browser }) => {
    const boardId = testBoardId();

    const userA = await createUserSession(browser, boardId, "Alice");
    const userB = await createUserSession(browser, boardId, "Bob");

    // Seed one draggable object.
    await createStickyNote(userA.page, 280, 280);
    await userA.page.waitForTimeout(400);
    await userB.page.waitForTimeout(800);

    // Baseline centroid on collaborator canvas.
    const pre = await sampleCanvasCentroids(userB.page, 180, 60);
    expect(pre.length).toBeGreaterThan(0);
    const initialX = median(pre.map((p) => p.x));

    // Start sampling on collaborator while owner performs a quick drop.
    const samplesPromise = sampleCanvasCentroids(userB.page, 1600, 70);

    await dragQuick(userA.page, 280, 280, 540, 320);

    const samples = await samplesPromise;
    expect(samples.length).toBeGreaterThan(6);

    const xs = samples.map((s) => s.x);
    const finalWindow = xs.slice(-4);
    const finalX = median(finalWindow);
    const delta = finalX - initialX;

    // Object should clearly move right.
    expect(delta).toBeGreaterThan(80);

    // Snap-back detector:
    // once we've reached near-final territory, we should not plunge back
    // toward the old position before settling.
    const nearFinalThreshold = initialX + delta * 0.7;
    const firstNearIdx = xs.findIndex((x) => x >= nearFinalThreshold);

    expect(firstNearIdx).toBeGreaterThanOrEqual(0);

    const trailing = xs.slice(firstNearIdx);
    const minAfterNearFinal = Math.min(...trailing);

    // Allow normal wiggle, but reject a major snap-back toward the origin.
    // If the object truly jumps back, minAfterNearFinal will fall close to
    // the initial position. We require it to stay in the latter half of the
    // movement trajectory after first reaching near-final territory.
    const minAllowedAfterNearFinal = initialX + delta * 0.55;
    expect(minAfterNearFinal).toBeGreaterThan(minAllowedAfterNearFinal);

    await userA.context.close();
    await userB.context.close();
  });
});
