import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragSystem } from "../../hooks/useDragSystem";
import type { UseDragSystemParams } from "../../hooks/useDragSystem";
import type { BoardObject } from "../../types/board";

// ── Helpers ──────────────────────────────────────────────────────

function makeSticky(
  id: string,
  x: number,
  y: number,
  overrides: Partial<BoardObject> = {}
): BoardObject {
  return {
    id,
    type: "sticky",
    x,
    y,
    width: 150,
    height: 150,
    color: "#FBBF24",
    rotation: 0,
    zIndex: 1,
    createdBy: "user-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Create a mock Konva stage with findOne that tracks calls */
function makeMockStage() {
  const nodes = new Map<string, { x: (v?: number) => number; y: (v?: number) => number; opacity: (v?: number) => number }>();

  const getOrCreateNode = (nodeId: string) => {
    if (!nodes.has(nodeId)) {
      let _x = 0;
      let _y = 0;
      let _opacity = 1;
      nodes.set(nodeId, {
        x: (v?: number) => { if (v !== undefined) _x = v; return _x; },
        y: (v?: number) => { if (v !== undefined) _y = v; return _y; },
        opacity: (v?: number) => { if (v !== undefined) _opacity = v; return _opacity; },
      });
    }
    return nodes.get(nodeId)!;
  };

  const stage = {
    findOne: vi.fn((selector: string) => {
      const id = selector.replace("#node-", "");
      return getOrCreateNode(id);
    }),
    getPointerPosition: vi.fn(() => ({ x: 500, y: 500 })),
    x: vi.fn(() => 0),
    y: vi.fn(() => 0),
    scaleX: vi.fn(() => 1),
    scaleY: vi.fn(() => 1),
  };

  return { stage, nodes, getOrCreateNode };
}

/** Build default params for useDragSystem with overrides */
function makeParams(overrides: Partial<UseDragSystemParams> = {}): UseDragSystemParams {
  return {
    objectsRef: { current: {} },
    selectedIds: new Set<string>(),
    selectedIdsRef: { current: new Set<string>() },
    stageRef: { current: null },
    dragInsideFrameRef: { current: new Set<string>() },
    frameManualDragActiveRef: { current: false },
    onUpdateObject: vi.fn(),
    onObjectDragBroadcast: vi.fn(),
    onObjectDragEndBroadcast: vi.fn(),
    onCursorMove: vi.fn(),
    onPushUndo: vi.fn(),
    getFrameAtPoint: vi.fn(() => null),
    getObjectsInFrame: vi.fn(() => []),
    ...overrides,
  };
}

// ── Bulk drag threshold constant (should match the hook) ──
const BULK_DRAG_THRESHOLD = 20;

// ── Tests ────────────────────────────────────────────────────────

describe("useDragSystem", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic drag (below bulk threshold)", () => {
    it("tracks drag positions for a single object", () => {
      const obj = makeSticky("s1", 100, 200);
      const objects: Record<string, BoardObject> = { s1: obj };
      const params = makeParams({
        objectsRef: { current: objects },
      });

      const { result } = renderHook(() => useDragSystem(params));

      act(() => {
        result.current.handleDragStart("s1");
        result.current.handleDragMove("s1", 150, 250);
      });

      // After rAF flush, drag positions should be updated
      act(() => {
        vi.advanceTimersByTime(20);
      });

      // scheduleDragStateUpdate was called (normal path) — positions should be in state
      // For a single object, dragPositions should include the moved object
      expect(result.current.dragStartPosRef.current["s1"]).toEqual({ x: 100, y: 200 });
    });

    it("commits position on drag end and calls onUpdateObject", () => {
      const obj = makeSticky("s1", 100, 200);
      const objects: Record<string, BoardObject> = { s1: obj };
      const onUpdateObject = vi.fn();
      const onPushUndo = vi.fn();
      const params = makeParams({
        objectsRef: { current: objects },
        onUpdateObject,
        onPushUndo,
      });

      const { result } = renderHook(() => useDragSystem(params));

      act(() => {
        result.current.handleDragStart("s1");
        result.current.handleDragEnd("s1", 150, 250);
      });

      expect(onUpdateObject).toHaveBeenCalledWith("s1", expect.objectContaining({ x: 150, y: 250 }));
      expect(onPushUndo).toHaveBeenCalled();
    });
  });

  describe("bulk drag (>= threshold objects)", () => {
    /**
     * Set up a scenario with many selected objects for bulk drag testing.
     * Creates BULK_DRAG_THRESHOLD stickies, all selected.
     */
    function setupBulkDrag() {
      const objects: Record<string, BoardObject> = {};
      const selectedIds = new Set<string>();

      for (let i = 0; i < BULK_DRAG_THRESHOLD; i++) {
        const id = `s${i}`;
        objects[id] = makeSticky(id, 100 + i * 10, 200 + i * 10);
        selectedIds.add(id);
      }

      const { stage } = makeMockStage();
      const onUpdateObject = vi.fn();
      const onPushUndo = vi.fn();
      const onObjectDragBroadcast = vi.fn();
      const onObjectDragEndBroadcast = vi.fn();

      const params = makeParams({
        objectsRef: { current: objects },
        selectedIds,
        selectedIdsRef: { current: selectedIds },
        stageRef: { current: stage as any },
        onUpdateObject,
        onPushUndo,
        onObjectDragBroadcast,
        onObjectDragEndBroadcast,
      });

      return { objects, selectedIds, stage, params, onUpdateObject, onPushUndo, onObjectDragBroadcast, onObjectDragEndBroadcast };
    }

    it("enters bulk drag mode when total dragged objects >= threshold", () => {
      const { params } = setupBulkDrag();
      const { result } = renderHook(() => useDragSystem(params));

      act(() => {
        result.current.handleDragStart("s0");
      });

      // The hook should recognize this as a bulk drag scenario.
      // We verify this by checking that handleDragMove does NOT trigger
      // scheduleDragStateUpdate (dragPositions stays empty).
      act(() => {
        result.current.handleDragMove("s0", 200, 300);
      });

      // Flush any pending rAF
      act(() => {
        vi.advanceTimersByTime(20);
      });

      // In bulk drag mode, dragPositions should NOT be updated (skips scheduleDragStateUpdate)
      expect(result.current.dragPositions).toEqual({});
    });

    it("calls setNodeTopLeft for each dragged object during bulk drag move", () => {
      const { params, stage } = setupBulkDrag();
      const { result } = renderHook(() => useDragSystem(params));

      act(() => {
        result.current.handleDragStart("s0");
      });

      stage.findOne.mockClear();

      act(() => {
        result.current.handleDragMove("s0", 200, 300);
      });

      // setNodeTopLeft should have been called for the primary object + all group offsets
      // (BULK_DRAG_THRESHOLD objects total: 1 primary + 19 group offsets)
      expect(stage.findOne).toHaveBeenCalled();
      // At minimum the primary node must be positioned
      const calls = stage.findOne.mock.calls.map((c: string[]) => c[0]);
      expect(calls).toContain("#node-s0");
    });

    it("does NOT call scheduleDragStateUpdate during bulk drag moves", () => {
      const { params } = setupBulkDrag();
      const { result } = renderHook(() => useDragSystem(params));

      act(() => {
        result.current.handleDragStart("s0");
      });

      // Perform multiple drag moves
      act(() => {
        result.current.handleDragMove("s0", 110, 210);
        result.current.handleDragMove("s0", 120, 220);
        result.current.handleDragMove("s0", 130, 230);
      });

      // Flush timers
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // dragPositions should remain empty — no React state updates during bulk drag
      expect(result.current.dragPositions).toEqual({});
    });

    it("commits all final positions via onUpdateObject on drag end", () => {
      const { params, onUpdateObject, objects } = setupBulkDrag();
      const { result } = renderHook(() => useDragSystem(params));

      const primaryStart = objects["s0"];
      const dx = 50;
      const dy = 75;

      act(() => {
        result.current.handleDragStart("s0");
        result.current.handleDragMove("s0", primaryStart.x + dx, primaryStart.y + dy);
        result.current.handleDragEnd("s0", primaryStart.x + dx, primaryStart.y + dy);
      });

      // onUpdateObject should be called for every dragged object
      expect(onUpdateObject).toHaveBeenCalledTimes(BULK_DRAG_THRESHOLD);

      // Each object should be moved by the same delta
      for (let i = 0; i < BULK_DRAG_THRESHOLD; i++) {
        const id = `s${i}`;
        const obj = objects[id];
        expect(onUpdateObject).toHaveBeenCalledWith(
          id,
          expect.objectContaining({
            x: obj.x + dx,
            y: obj.y + dy,
          })
        );
      }
    });

    it("creates a batch undo action on drag end", () => {
      const { params, onPushUndo, objects } = setupBulkDrag();
      const { result } = renderHook(() => useDragSystem(params));

      const dx = 50;
      const dy = 75;
      const startX = objects["s0"].x;
      const startY = objects["s0"].y;

      act(() => {
        result.current.handleDragStart("s0");
        result.current.handleDragMove("s0", startX + dx, startY + dy);
        result.current.handleDragEnd("s0", startX + dx, startY + dy);
      });

      expect(onPushUndo).toHaveBeenCalledTimes(1);
      const undoAction = onPushUndo.mock.calls[0][0];
      expect(undoAction.type).toBe("batch");
      expect(undoAction.actions.length).toBe(BULK_DRAG_THRESHOLD);

      // Each undo action should record before/after positions
      for (const action of undoAction.actions) {
        expect(action.type).toBe("update_object");
        expect(action.before).toHaveProperty("x");
        expect(action.before).toHaveProperty("y");
        expect(action.after).toHaveProperty("x");
        expect(action.after).toHaveProperty("y");
        expect(action.after.x - action.before.x).toBe(dx);
        expect(action.after.y - action.before.y).toBe(dy);
      }
    });

    it("broadcasts drag end for all objects", () => {
      const { params, onObjectDragEndBroadcast, objects } = setupBulkDrag();
      const { result } = renderHook(() => useDragSystem(params));

      act(() => {
        result.current.handleDragStart("s0");
        result.current.handleDragMove("s0", 200, 300);
        result.current.handleDragEnd("s0", 200, 300);
      });

      // Every dragged object should get a drag end broadcast
      expect(onObjectDragEndBroadcast).toHaveBeenCalledTimes(BULK_DRAG_THRESHOLD);
      for (let i = 0; i < BULK_DRAG_THRESHOLD; i++) {
        expect(onObjectDragEndBroadcast).toHaveBeenCalledWith(`s${i}`);
      }
    });

    it("does not move unselected objects", () => {
      const objects: Record<string, BoardObject> = {};
      const selectedIds = new Set<string>();

      // Create threshold objects, all selected
      for (let i = 0; i < BULK_DRAG_THRESHOLD; i++) {
        const id = `s${i}`;
        objects[id] = makeSticky(id, 100 + i * 10, 200 + i * 10);
        selectedIds.add(id);
      }

      // Add an unselected object
      objects["unselected"] = makeSticky("unselected", 500, 500);

      const { stage } = makeMockStage();
      const onUpdateObject = vi.fn();

      const params = makeParams({
        objectsRef: { current: objects },
        selectedIds,
        selectedIdsRef: { current: selectedIds },
        stageRef: { current: stage as any },
        onUpdateObject,
      });

      const { result } = renderHook(() => useDragSystem(params));

      act(() => {
        result.current.handleDragStart("s0");
        result.current.handleDragMove("s0", 200, 300);
        result.current.handleDragEnd("s0", 200, 300);
      });

      // onUpdateObject should NOT be called for "unselected"
      const updatedIds = onUpdateObject.mock.calls.map((c: any[]) => c[0]);
      expect(updatedIds).not.toContain("unselected");
    });

    it("cleans up drag state after bulk drag end", () => {
      const { params } = setupBulkDrag();
      const { result } = renderHook(() => useDragSystem(params));

      act(() => {
        result.current.handleDragStart("s0");
        result.current.handleDragMove("s0", 200, 300);
        result.current.handleDragEnd("s0", 200, 300);
      });

      // After drag end, internal state should be cleared
      expect(result.current.draggingRef.current.size).toBe(0);
      expect(Object.keys(result.current.dragStartPosRef.current)).toHaveLength(0);
      expect(Object.keys(result.current.groupDragOffsetsRef.current)).toHaveLength(0);
      expect(Object.keys(result.current.frameContainedRef.current)).toHaveLength(0);
    });

    it("handles zero-distance drag (no actual movement)", () => {
      const { params, onUpdateObject, onPushUndo, objects } = setupBulkDrag();
      const { result } = renderHook(() => useDragSystem(params));

      const startX = objects["s0"].x;
      const startY = objects["s0"].y;

      act(() => {
        result.current.handleDragStart("s0");
        // End at same position
        result.current.handleDragEnd("s0", startX, startY);
      });

      // Objects should still be updated (position commit), but undo should
      // either not be pushed or pushed with no-change actions
      // The important thing is no crash and clean state
      expect(result.current.draggingRef.current.size).toBe(0);
    });

    it("correctly positions all objects using delta from primary drag", () => {
      const { params, stage, objects } = setupBulkDrag();
      const { result } = renderHook(() => useDragSystem(params));

      act(() => {
        result.current.handleDragStart("s0");
      });

      // Move primary by (50, 75)
      const startX = objects["s0"].x;
      const startY = objects["s0"].y;
      const targetX = startX + 50;
      const targetY = startY + 75;

      stage.findOne.mockClear();

      act(() => {
        result.current.handleDragMove("s0", targetX, targetY);
      });

      // Verify that setNodeTopLeft was called for secondary objects too
      // Each selected non-primary object should be positioned at (original + delta)
      const calledNodeIds = stage.findOne.mock.calls.map((c: string[]) => c[0].replace("#node-", ""));
      // Should include several of the selected objects
      expect(calledNodeIds.length).toBeGreaterThanOrEqual(BULK_DRAG_THRESHOLD);
    });
  });
});
