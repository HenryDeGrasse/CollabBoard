import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndoRedo } from "../../hooks/useUndoRedo";
import type { BoardObject, Connector } from "../../types/board";

function makeObject(id: string, overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id,
    type: "sticky",
    x: 0,
    y: 0,
    width: 150,
    height: 150,
    color: "#FBBF24",
    text: "",
    rotation: 0,
    zIndex: 1,
    createdBy: "user-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeConnector(id: string): Connector {
  return { id, fromId: "a", toId: "b", style: "arrow" };
}

function setup() {
  const mocks = {
    createObject: vi.fn(() => "new-id"),
    updateObject: vi.fn(),
    deleteObject: vi.fn(),
    createConnector: vi.fn(() => "new-conn"),
    deleteConnector: vi.fn(),
    restoreObject: vi.fn(),
    restoreConnector: vi.fn(),
  };

  const { result } = renderHook(() =>
    useUndoRedo(
      mocks.createObject,
      mocks.updateObject,
      mocks.deleteObject,
      mocks.createConnector,
      mocks.deleteConnector,
      mocks.restoreObject,
      mocks.restoreConnector,
    )
  );

  return { result, mocks };
}

describe("useUndoRedo hook", () => {
  it("starts with empty stacks", () => {
    const { result } = setup();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("can undo a create_object by deleting it", () => {
    const { result, mocks } = setup();
    const obj = makeObject("obj-1");

    act(() => result.current.pushAction({ type: "create_object", objectId: "obj-1", object: obj }));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(mocks.deleteObject).toHaveBeenCalledWith("obj-1");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it("can redo a create_object by restoring it", () => {
    const { result, mocks } = setup();
    const obj = makeObject("obj-1");

    act(() => result.current.pushAction({ type: "create_object", objectId: "obj-1", object: obj }));
    act(() => result.current.undo());
    act(() => result.current.redo());

    expect(mocks.restoreObject).toHaveBeenCalledWith(obj);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("can undo a delete_object by restoring it", () => {
    const { result, mocks } = setup();
    const obj = makeObject("obj-1");

    act(() => result.current.pushAction({ type: "delete_object", objectId: "obj-1", object: obj }));
    act(() => result.current.undo());

    expect(mocks.restoreObject).toHaveBeenCalledWith(obj);
  });

  it("can undo an update_object by applying before values", () => {
    const { result, mocks } = setup();

    act(() =>
      result.current.pushAction({
        type: "update_object",
        objectId: "obj-1",
        before: { x: 0, y: 0 },
        after: { x: 100, y: 200 },
      })
    );
    act(() => result.current.undo());

    expect(mocks.updateObject).toHaveBeenCalledWith("obj-1", { x: 0, y: 0 });
  });

  it("can undo a batch action in reverse order", () => {
    const { result, mocks } = setup();
    const obj1 = makeObject("obj-1");
    const obj2 = makeObject("obj-2");

    act(() =>
      result.current.pushAction({
        type: "batch",
        actions: [
          { type: "delete_object", objectId: "obj-1", object: obj1 },
          { type: "delete_object", objectId: "obj-2", object: obj2 },
        ],
      })
    );
    act(() => result.current.undo());

    // Batch undone in reverse: obj-2 restored first, then obj-1
    expect(mocks.restoreObject).toHaveBeenCalledTimes(2);
    expect(mocks.restoreObject).toHaveBeenNthCalledWith(1, obj2);
    expect(mocks.restoreObject).toHaveBeenNthCalledWith(2, obj1);
  });

  it("can undo/redo connector operations", () => {
    const { result, mocks } = setup();
    const conn = makeConnector("conn-1");

    act(() => result.current.pushAction({ type: "create_connector", connectorId: "conn-1", connector: conn }));
    act(() => result.current.undo());

    expect(mocks.deleteConnector).toHaveBeenCalledWith("conn-1");

    act(() => result.current.redo());
    expect(mocks.restoreConnector).toHaveBeenCalledWith(conn);
  });

  it("clears redo stack on new action", () => {
    const { result } = setup();
    const obj = makeObject("obj-1");

    act(() => result.current.pushAction({ type: "create_object", objectId: "obj-1", object: obj }));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.pushAction({ type: "create_object", objectId: "obj-2", object: makeObject("obj-2") }));
    expect(result.current.canRedo).toBe(false);
  });

  it("respects max depth of 30", () => {
    const { result } = setup();

    act(() => {
      for (let i = 0; i < 40; i++) {
        result.current.pushAction({
          type: "create_object",
          objectId: `obj-${i}`,
          object: makeObject(`obj-${i}`),
        });
      }
    });

    // Should be capped at 30
    let undoCount = 0;
    for (let i = 0; i < 40; i++) {
      if (!result.current.canUndo) break;
      act(() => result.current.undo());
      undoCount++;
    }
    expect(undoCount).toBe(30);
  });
});
