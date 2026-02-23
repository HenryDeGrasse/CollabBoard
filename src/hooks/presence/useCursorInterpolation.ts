import { useRef, useCallback, useEffect, useState } from "react";
import type { CursorStore } from "./usePresence";

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
 *
 * ── Performance note ──
 * This hook's forceUpdate() only re-renders the component that calls it.
 * It is designed to be used inside a small, isolated cursor-rendering
 * component — NOT inside Board — so the rAF loop doesn't trigger
 * expensive Board reconciliation.
 */

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

interface UserMeta {
  id: string;
  displayName: string;
  cursorColor: string;
  online: boolean;
}

/**
 * Given a cursor store (ref-based, outside React state) and user metadata,
 * returns smoothly interpolated cursor positions updated every rAF frame.
 *
 * The forceUpdate() inside the rAF loop only re-renders the component
 * that calls this hook — keep it in a small isolated component.
 */
export function useCursorInterpolation(
  cursorStore: CursorStore,
  users: Record<string, UserMeta>,
  currentUserId: string,
): InterpolatedCursor[] {
  // Mutable interp state per user — lives across renders, mutated in rAF
  const stateMap = useRef<Map<string, InterpState>>(new Map());
  // Latest interpolated positions — written by rAF, read by render
  const outputRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const forceUpdate = useForceUpdate();
  const rafIdRef = useRef<number>(0);
  const activeRef = useRef(false);

  // Previous raw positions — to detect actual movement
  const prevRawRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // ── Process incoming cursor store changes ──
  const processNewPositions = useCallback(() => {
    const positions = cursorStore.get();
    const now = performance.now();
    let anyNew = false;

    const aliveIds = new Set<string>();

    for (const [id, pos] of Object.entries(positions)) {
      // Skip self
      if (id === currentUserId) continue;
      // Skip users who aren't online
      if (!users[id]?.online) continue;

      aliveIds.add(id);
      const prev = prevRawRef.current.get(id);

      // Skip if position hasn't actually changed
      if (prev && prev.x === pos.x && prev.y === pos.y) continue;

      anyNew = true;
      const state = stateMap.current.get(id);

      if (!state) {
        // First time seeing this cursor — snap
        stateMap.current.set(id, {
          fromX: pos.x,
          fromY: pos.y,
          toX: pos.x,
          toY: pos.y,
          startTime: now,
          duration: 30,
          lastUpdateTime: now,
        });
        outputRef.current.set(id, { x: pos.x, y: pos.y });
      } else {
        // Measure adaptive duration from actual broadcast interval
        const measuredInterval = now - state.lastUpdateTime;
        const duration = Math.min(Math.max(measuredInterval, 8), 80);

        const current = getCurrentPos(state, now);
        state.fromX = current.x;
        state.fromY = current.y;
        state.toX = pos.x;
        state.toY = pos.y;
        state.startTime = now;
        state.duration = duration;
        state.lastUpdateTime = now;
      }

      prevRawRef.current.set(id, { x: pos.x, y: pos.y });
    }

    // Clean up departed cursors
    for (const id of stateMap.current.keys()) {
      if (!aliveIds.has(id)) {
        stateMap.current.delete(id);
        outputRef.current.delete(id);
        prevRawRef.current.delete(id);
        anyNew = true;
      }
    }

    // Start rAF loop if we got new positions
    if (anyNew && !activeRef.current && stateMap.current.size > 0) {
      activeRef.current = true;
      rafIdRef.current = requestAnimationFrame(tick);
    }
  }, [cursorStore, users, currentUserId]); // tick added below via ref

  // ── rAF loop ──
  const tickRef = useRef(processNewPositions);
  tickRef.current = processNewPositions;

  const tick = useCallback(() => {
    const now = performance.now();
    let anyMoving = false;

    for (const [id, state] of stateMap.current) {
      const pos = getCurrentPos(state, now);
      outputRef.current.set(id, pos);
      const t = (now - state.startTime) / state.duration;
      if (t < 1) anyMoving = true;
    }

    forceUpdate();

    if (anyMoving) {
      rafIdRef.current = requestAnimationFrame(tick);
    } else {
      activeRef.current = false;
    }
  }, [forceUpdate]);

  // ── Process positions synchronously on render ──
  // This ensures the output array is populated on the very first render
  // (useEffect would be too late for the initial return value).
  processNewPositions();

  // ── Subscribe to cursor store for future updates ──
  useEffect(() => {
    return cursorStore.subscribe(() => {
      processNewPositions();
      // Ensure rAF is running after new positions arrive
      if (!activeRef.current && stateMap.current.size > 0) {
        activeRef.current = true;
        rafIdRef.current = requestAnimationFrame(tick);
      }
    });
  }, [cursorStore, processNewPositions, tick]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  // ── Build output array ──
  // Re-read outputRef on every render (forceUpdate triggers this)
  const result: InterpolatedCursor[] = [];
  for (const [id, pos] of outputRef.current) {
    const user = users[id];
    if (!user || !user.online || id === currentUserId) continue;
    result.push({
      id,
      displayName: user.displayName,
      color: user.cursorColor,
      x: pos.x,
      y: pos.y,
    });
  }
  return result;
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
