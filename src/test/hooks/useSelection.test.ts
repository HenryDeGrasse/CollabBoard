import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSelection } from "../../hooks/useSelection";

describe("useSelection hook", () => {
  it("starts with empty selection", () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("selects a single object", () => {
    const { result } = renderHook(() => useSelection());

    act(() => {
      result.current.select("obj-1");
    });

    expect(result.current.selectedIds.size).toBe(1);
    expect(result.current.isSelected("obj-1")).toBe(true);
  });

  it("single select replaces previous selection", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.select("obj-1"));
    act(() => result.current.select("obj-2"));

    expect(result.current.selectedIds.size).toBe(1);
    expect(result.current.isSelected("obj-1")).toBe(false);
    expect(result.current.isSelected("obj-2")).toBe(true);
  });

  it("multi-select adds to selection", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.select("obj-1"));
    act(() => result.current.select("obj-2", true));

    expect(result.current.selectedIds.size).toBe(2);
    expect(result.current.isSelected("obj-1")).toBe(true);
    expect(result.current.isSelected("obj-2")).toBe(true);
  });

  it("multi-select toggles off already selected", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.select("obj-1"));
    act(() => result.current.select("obj-2", true));
    act(() => result.current.select("obj-1", true)); // toggle off

    expect(result.current.selectedIds.size).toBe(1);
    expect(result.current.isSelected("obj-1")).toBe(false);
    expect(result.current.isSelected("obj-2")).toBe(true);
  });

  it("deselects a specific object", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.select("obj-1"));
    act(() => result.current.select("obj-2", true));
    act(() => result.current.deselect("obj-1"));

    expect(result.current.selectedIds.size).toBe(1);
    expect(result.current.isSelected("obj-1")).toBe(false);
    expect(result.current.isSelected("obj-2")).toBe(true);
  });

  it("clears all selection", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.select("obj-1"));
    act(() => result.current.select("obj-2", true));
    act(() => result.current.clearSelection());

    expect(result.current.selectedIds.size).toBe(0);
  });

  it("selectMultiple sets exact selection", () => {
    const { result } = renderHook(() => useSelection());

    act(() => result.current.select("other"));
    act(() => result.current.selectMultiple(["a", "b", "c"]));

    expect(result.current.selectedIds.size).toBe(3);
    expect(result.current.isSelected("a")).toBe(true);
    expect(result.current.isSelected("b")).toBe(true);
    expect(result.current.isSelected("c")).toBe(true);
    expect(result.current.isSelected("other")).toBe(false);
  });

  it("isSelected returns false for unselected ids", () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.isSelected("nonexistent")).toBe(false);
  });
});
