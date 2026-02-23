import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../utils/text", () => ({
  calculateFontSize: vi.fn(() => 16),
  getAutoContrastingTextColor: vi.fn(() => "#1F2937"),
  getFrameHeaderHeight: vi.fn(() => 40),
  resolveObjectTextSize: vi.fn(() => 14),
  estimateVerticalPaddingTop: vi.fn(() => 10),
}));

import { TextOverlay } from "../../components/canvas/TextOverlay";
import type { BoardObject } from "../../types/board";

function makeObject(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: "obj-1",
    type: "sticky",
    x: 100,
    y: 100,
    width: 200,
    height: 200,
    color: "#FBBF24",
    text: "Hello World",
    rotation: 0,
    zIndex: 1,
    createdBy: "user-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const defaultProps = {
  stageX: 0,
  stageY: 0,
  scale: 1,
  onCommit: vi.fn(),
  onCancel: vi.fn(),
  onDraftChange: vi.fn(),
};

describe("TextOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a textarea element", () => {
    render(<TextOverlay object={makeObject()} {...defaultProps} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("initializes with the object text", () => {
    render(<TextOverlay object={makeObject({ text: "Hello World" })} {...defaultProps} />);
    expect(screen.getByRole("textbox")).toHaveValue("Hello World");
  });

  it("initializes with empty string when text is undefined", () => {
    render(<TextOverlay object={makeObject({ text: undefined })} {...defaultProps} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("calls onCommit with object id and text on Enter", () => {
    const onCommit = vi.fn();
    render(<TextOverlay object={makeObject()} {...defaultProps} onCommit={onCommit} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("obj-1", "Hello World");
  });

  it("does not commit on Shift+Enter (allows newlines)", () => {
    const onCommit = vi.fn();
    render(<TextOverlay object={makeObject()} {...defaultProps} onCommit={onCommit} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("calls onCancel on Escape", () => {
    const onCancel = vi.fn();
    render(<TextOverlay object={makeObject()} {...defaultProps} onCancel={onCancel} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCommit on blur", () => {
    const onCommit = vi.fn();
    render(<TextOverlay object={makeObject()} {...defaultProps} onCommit={onCommit} />);

    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).toHaveBeenCalledWith("obj-1", "Hello World");
  });

  it("calls onDraftChange when typing", async () => {
    const onDraftChange = vi.fn();
    render(<TextOverlay object={makeObject({ text: "" })} {...defaultProps} onDraftChange={onDraftChange} />);

    await userEvent.setup().type(screen.getByRole("textbox"), "A");
    expect(onDraftChange).toHaveBeenCalledWith("A");
  });

  it("renders for circle objects", () => {
    render(<TextOverlay object={makeObject({ type: "circle" })} {...defaultProps} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("renders for frame objects", () => {
    render(<TextOverlay object={makeObject({ type: "frame" })} {...defaultProps} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
