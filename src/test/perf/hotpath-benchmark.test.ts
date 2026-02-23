/**
 * Micro-benchmarks for computational hot paths.
 *
 * Measures raw execution time of:
 *  1. zIndex fingerprint + sort (useObjectPartitioning)
 *  2. parentFrameKey fingerprint (useObjectPartitioning)
 *  3. Viewport culling filter pass
 *  4. objectsWithLivePositions merge (useLivePositions)
 *  5. constrainObjectOutsideFrames (frame.ts, called per drag-move)
 *  6. TopLevelConnectors filter chain
 *  7. setObjects spreads in useBoard (Realtime handler)
 */
import { describe, it, expect } from "vitest";
import type { BoardObject, Connector } from "../../types/board";

// ── Helpers to generate realistic test data ──

function makeObject(i: number, parentFrameId?: string): BoardObject {
  return {
    id: `obj-${i}`,
    type: i % 10 === 0 ? "frame" : i % 3 === 0 ? "sticky" : i % 3 === 1 ? "rectangle" : "circle",
    x: (i % 50) * 200,
    y: Math.floor(i / 50) * 200,
    width: 150,
    height: 100,
    color: "#FFEB3B",
    text: `Note ${i}`,
    rotation: 0,
    zIndex: i,
    createdBy: "user-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    parentFrameId: parentFrameId || null,
  };
}

function makeConnector(i: number, fromId: string, toId: string): Connector {
  return {
    id: `conn-${i}`,
    fromId,
    toId,
    style: i % 2 === 0 ? "arrow" : "line",
  };
}

function buildBoard(objectCount: number): {
  objects: Record<string, BoardObject>;
  connectors: Record<string, Connector>;
} {
  const objects: Record<string, BoardObject> = {};
  const connectors: Record<string, Connector> = {};
  const frameIds: string[] = [];

  for (let i = 0; i < objectCount; i++) {
    const obj = makeObject(i);
    if (obj.type === "frame") frameIds.push(obj.id);
    objects[obj.id] = obj;
  }

  // Assign ~60% of non-frame objects to frames
  let frameIdx = 0;
  for (const obj of Object.values(objects)) {
    if (obj.type !== "frame" && frameIds.length > 0 && Math.random() < 0.6) {
      obj.parentFrameId = frameIds[frameIdx % frameIds.length];
      frameIdx++;
    }
  }

  // Create connectors (~20% of object count)
  const objIds = Object.keys(objects);
  for (let i = 0; i < Math.floor(objectCount * 0.2); i++) {
    const fromId = objIds[i % objIds.length];
    const toId = objIds[(i + 1) % objIds.length];
    const conn = makeConnector(i, fromId, toId);
    connectors[conn.id] = conn;
  }

  return { objects, connectors };
}

// ── Benchmark: zIndex fingerprint ──

describe("Hot-path benchmarks", () => {
  const SIZES = [100, 500, 1000];

  for (const N of SIZES) {
    const { objects, connectors } = buildBoard(N);
    const objectsArr = Object.values(objects);
    const objectsEntries = Object.entries(objects);

    it(`zIndex fingerprint build (N=${N})`, () => {
      const ITERS = 1000;
      const start = performance.now();
      for (let iter = 0; iter < ITERS; iter++) {
        let key = "";
        for (const [id, obj] of objectsEntries) {
          key += id + ":" + (obj.zIndex ?? 0) + "|";
        }
      }
      const elapsed = performance.now() - start;
      const perIter = elapsed / ITERS;
      console.log(`  zIndex fingerprint (N=${N}): ${perIter.toFixed(3)}ms/iter`);
      expect(perIter).toBeLessThan(50); // sanity
    });

    it(`parentFrameKey fingerprint build (N=${N})`, () => {
      const ITERS = 1000;
      const start = performance.now();
      for (let iter = 0; iter < ITERS; iter++) {
        let key = "";
        for (const [id, obj] of objectsEntries) {
          key += id + ":" + (obj.parentFrameId ?? "") + "|";
        }
      }
      const elapsed = performance.now() - start;
      const perIter = elapsed / ITERS;
      console.log(`  parentFrameKey fingerprint (N=${N}): ${perIter.toFixed(3)}ms/iter`);
      expect(perIter).toBeLessThan(50);
    });

    it(`sort by zIndex (N=${N})`, () => {
      const ITERS = 500;
      const start = performance.now();
      for (let iter = 0; iter < ITERS; iter++) {
        const arr = [...objectsArr];
        arr.sort((a, b) => {
          const dz = (a.zIndex || 0) - (b.zIndex || 0);
          return dz !== 0 ? dz : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
      }
      const elapsed = performance.now() - start;
      const perIter = elapsed / ITERS;
      console.log(`  sort by zIndex (N=${N}): ${perIter.toFixed(3)}ms/iter`);
      expect(perIter).toBeLessThan(100);
    });

    it(`viewport culling filter (N=${N})`, () => {
      const bounds = { left: -500, top: -500, right: 3000, bottom: 3000 };
      const isInViewport = (obj: BoardObject) =>
        obj.x + obj.width >= bounds.left &&
        obj.x <= bounds.right &&
        obj.y + obj.height >= bounds.top &&
        obj.y <= bounds.bottom;

      const ITERS = 2000;
      const start = performance.now();
      for (let iter = 0; iter < ITERS; iter++) {
        objectsArr.filter((obj) => isInViewport(obj));
      }
      const elapsed = performance.now() - start;
      const perIter = elapsed / ITERS;
      console.log(`  viewport culling filter (N=${N}): ${perIter.toFixed(3)}ms/iter`);
      expect(perIter).toBeLessThan(50);
    });

    it(`objectsWithLivePositions merge — full rebuild (N=${N})`, () => {
      // Simulate 5 objects being dragged
      const dragIds = Object.keys(objects).slice(0, 5);
      const resolvedLive: Record<string, { x: number; y: number }> = {};
      for (const id of dragIds) {
        resolvedLive[id] = { x: objects[id].x + 10, y: objects[id].y + 10 };
      }

      const ITERS = 1000;
      const start = performance.now();
      for (let iter = 0; iter < ITERS; iter++) {
        const result: Record<string, BoardObject> = {};
        for (const [id, obj] of Object.entries(objects)) {
          const live = resolvedLive[id];
          if (!live) {
            result[id] = obj;
          } else {
            result[id] = { ...obj, ...live };
          }
        }
      }
      const elapsed = performance.now() - start;
      const perIter = elapsed / ITERS;
      console.log(`  objectsWithLivePositions full rebuild (N=${N}, 5 dragged): ${perIter.toFixed(3)}ms/iter`);
      expect(perIter).toBeLessThan(50);
    });

    it(`setObjects spread (Realtime update pattern) (N=${N})`, () => {
      // Simulate the { ...prev, [obj.id]: obj } pattern in Realtime handler
      const ITERS = 500;
      const testObj = { ...objectsArr[0], x: 999 };
      const start = performance.now();
      let current = objects;
      for (let iter = 0; iter < ITERS; iter++) {
        current = { ...current, [testObj.id]: testObj };
      }
      const elapsed = performance.now() - start;
      const perIter = elapsed / ITERS;
      console.log(`  setObjects spread (N=${N}): ${perIter.toFixed(3)}ms/iter`);
      expect(perIter).toBeLessThan(50);
    });

    it(`TopLevelConnectors filter chain (N=${N})`, () => {
      const connArr = Object.values(connectors);
      const poppedOut = new Set<string>();
      const bounds = { left: -500, top: -500, right: 3000, bottom: 3000 };

      const ITERS = 1000;
      const start = performance.now();
      for (let iter = 0; iter < ITERS; iter++) {
        connArr
          .filter((conn) => {
            const from = conn.fromId ? objects[conn.fromId] : undefined;
            const to = conn.toId ? objects[conn.toId] : undefined;
            const fromFrame = from?.parentFrameId ?? null;
            const toFrame = to?.parentFrameId ?? null;
            if (poppedOut.has(conn.fromId) || poppedOut.has(conn.toId)) return true;
            if (!conn.fromId || !conn.toId) return true;
            return !(fromFrame !== null && fromFrame === toFrame);
          })
          .filter((conn) => {
            const from = conn.fromId ? objects[conn.fromId] : undefined;
            const to = conn.toId ? objects[conn.toId] : undefined;
            if (!from || !to) return true;
            const minX = Math.min(from.x, to.x);
            const maxX = Math.max(from.x + from.width, to.x + to.width);
            const minY = Math.min(from.y, to.y);
            const maxY = Math.max(from.y + from.height, to.y + to.height);
            return maxX >= bounds.left && minX <= bounds.right && maxY >= bounds.top && minY <= bounds.bottom;
          });
      }
      const elapsed = performance.now() - start;
      const perIter = elapsed / ITERS;
      console.log(`  TopLevelConnectors filter (N=${N}, ${connArr.length} conns): ${perIter.toFixed(3)}ms/iter`);
      expect(perIter).toBeLessThan(50);
    });
  }
});
