import { useRef, useCallback, useEffect, useMemo } from "react";

/**
 * Micro-interpolation for remote cursors.
 *
 * The goal: smooth out the discrete 30ms broadcast hops so cursors glide,
 * but **never fall behind**.  When a new position arrives the rendered
 * cursor must already be at (or within ~1 px of) the *previous* target.
 *
 * ── How it works ──
 *
 * For each remote user we keep a tiny state machine:
 *
 *   from ───── lerp(t) ─────▶ to
 *    ↑ startTime              ↑ startTime + duration
 *
 * When a new position arrives:
 *   1. `from` = wherever the cursor is right now (getCurrentPos)
 *   2. `to`   = new position
 *   3. `duration` = time since the last update (adaptive)
 *      clamped to [8 ms, 80 ms] so a single network hiccup can't
 *      cause a long slow glide or a teleport.
 *   4. `startTime` = performance.now()
 *
 * A single rAF loop ticks all cursors.  For each one it computes
 *   t = clamp((now − startTime) / duration, 0, 1)
 * and linearly interpolates.  When t ≥ 1, the cursor sits exactly
 * at `to` with zero drift.
 *
 * Because `duration` ≈ the actual broadcast interval, by the time
 * the *next* update arrives t is ≈ 1.0 and the cursor is already
 * at (or within a sub-pixel of) the target.  No accumulating lag.
 *
 * ── Why linear? ──
 * At 30–50 ms segments (~2-3 frames) any easing curve is imperceptible.
 * Linear is cheapest and guarantees arrival at t = 1 with no overshoot.
 */

interface CursorTarget {
  /** Raw position from presence (what the broadcaster sent) */
  x: number;
  y: number;
}

interface InterpState {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startTime: number; // performance.now()
  duration: number; // ms — adaptive per cursor
  lastUpdateTime: number;
}

export interface InterpolatedCursor {
  id: string;
  displayName: string;
  color: string;
  x: number;
  y: number;
}

/**
 * Given a list of raw remote cursor positions (from presence),
 * returns smoothly interpolated positions updated every rAF frame.
 */
export function useCursorInterpolation(
  rawCursors: { id: string; displayName: string; color: string; x: number; y: number }[],
): InterpolatedCursor[] {
  // Mutable interp state per user — lives across renders, mutated in rAF
  const stateMap = useRef<Map<string, InterpState>>(new Map());
  // Latest interpolated positions — written by rAF, read by render
  const outputRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Force re-render trigger
  const tickRef = useRef(0);
  const forceUpdate = useForceUpdate();
  const rafIdRef = useRef<number>(0);
  const activeRef = useRef(false);

  // ── Process incoming raw positions ──
  // This runs every time presence data changes (every ~30ms for moving cursors)
  const prevRawRef = useRef<Map<string, CursorTarget>>(new Map());

  useMemo(() => {
    const now = performance.now();
    const aliveIds = new Set<string>();

    for (const cursor of rawCursors) {
      aliveIds.add(cursor.id);
      const prev = prevRawRef.current.get(cursor.id);

      // Skip if position hasn't actually changed
      if (prev && prev.x === cursor.x && prev.y === cursor.y) continue;

      const state = stateMap.current.get(cursor.id);

      if (!state) {
        // First time seeing this cursor — no interpolation, snap
        stateMap.current.set(cursor.id, {
          fromX: cursor.x,
          fromY: cursor.y,
          toX: cursor.x,
          toY: cursor.y,
          startTime: now,
          duration: 30,
          lastUpdateTime: now,
        });
        outputRef.current.set(cursor.id, { x: cursor.x, y: cursor.y });
      } else {
        // Measure adaptive duration from actual broadcast interval
        const measuredInterval = now - state.lastUpdateTime;
        // Clamp: min 8ms (don't divide-by-near-zero), max 80ms (don't glide forever)
        const duration = Math.min(Math.max(measuredInterval, 8), 80);

        // Start from wherever the cursor is RIGHT NOW (not from the old target)
        const current = getCurrentPos(state, now);
        state.fromX = current.x;
        state.fromY = current.y;
        state.toX = cursor.x;
        state.toY = cursor.y;
        state.startTime = now;
        state.duration = duration;
        state.lastUpdateTime = now;
      }

      prevRawRef.current.set(cursor.id, { x: cursor.x, y: cursor.y });
    }

    // Clean up departed cursors
    for (const id of stateMap.current.keys()) {
      if (!aliveIds.has(id)) {
        stateMap.current.delete(id);
        outputRef.current.delete(id);
        prevRawRef.current.delete(id);
      }
    }
  }, [rawCursors]);

  // ── rAF loop ──
  const tick = useCallback(() => {
    const now = performance.now();
    let anyMoving = false;

    for (const [id, state] of stateMap.current) {
      const pos = getCurrentPos(state, now);
      outputRef.current.set(id, pos);

      // Check if this cursor is still mid-interpolation
      const t = (now - state.startTime) / state.duration;
      if (t < 1) anyMoving = true;
    }

    tickRef.current++;
    forceUpdate();

    if (anyMoving) {
      rafIdRef.current = requestAnimationFrame(tick);
    } else {
      activeRef.current = false;
    }
  }, [forceUpdate]);

  // Start the rAF loop when cursors are moving
  useEffect(() => {
    if (rawCursors.length > 0 && !activeRef.current) {
      activeRef.current = true;
      rafIdRef.current = requestAnimationFrame(tick);
    }
    return () => {
      // Don't cancel on every render — only on unmount
    };
  }, [rawCursors, tick]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // ── Build output array ──
  return useMemo(() => {
    // Read tickRef to create a dependency on the rAF counter
    void tickRef.current;
    return rawCursors.map((cursor) => {
      const pos = outputRef.current.get(cursor.id);
      return {
        id: cursor.id,
        displayName: cursor.displayName,
        color: cursor.color,
        x: pos?.x ?? cursor.x,
        y: pos?.y ?? cursor.y,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCursors, tickRef.current]);
}

// ── Pure helpers ──

function getCurrentPos(
  state: InterpState,
  now: number,
): { x: number; y: number } {
  const elapsed = now - state.startTime;
  const t = Math.min(elapsed / state.duration, 1); // clamp [0, 1]
  return {
    x: state.fromX + (state.toX - state.fromX) * t,
    y: state.fromY + (state.toY - state.fromY) * t,
  };
}

/** Minimal force-update hook — increments a counter to trigger re-render */
function useForceUpdate() {
  const [, setState] = useState(0);
  return useCallback(() => setState((n) => n + 1), []);
}

// Need useState for useForceUpdate
import { useState } from "react";
