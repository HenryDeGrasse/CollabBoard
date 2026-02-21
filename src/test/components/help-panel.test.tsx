import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpPanel, getShortcuts } from "../../components/ui/HelpPanel";

describe("HelpPanel", () => {
  it("renders the help button", () => {
    render(<HelpPanel />);
    expect(screen.getByTitle("Keyboard shortcuts (?)")).toBeTruthy();
  });

  it("opens when the help button is clicked", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTitle("Keyboard shortcuts (?)"));
    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();
  });

  it("closes when backdrop is clicked", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTitle("Keyboard shortcuts (?)"));
    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();
    fireEvent.click(screen.getByTestId("help-panel-backdrop"));
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });

  it("closes when X button is clicked", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTitle("Keyboard shortcuts (?)"));
    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });

  it("toggles open/close with ? key", () => {
    render(<HelpPanel />);
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();

    // Press ? to open
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByText("Keyboard Shortcuts")).toBeTruthy();

    // Press ? again to close
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });

  it("does not toggle when typing in an input", () => {
    render(
      <div>
        <input data-testid="text-input" />
        <HelpPanel />
      </div>
    );
    const input = screen.getByTestId("text-input");
    input.focus();
    fireEvent.keyDown(input, { key: "?" });
    expect(screen.queryByText("Keyboard Shortcuts")).toBeNull();
  });

  it("displays all tool shortcuts", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTitle("Keyboard shortcuts (?)"));

    expect(screen.getByText("Select tool")).toBeTruthy();
    expect(screen.getByText("Sticky Note tool")).toBeTruthy();
    expect(screen.getByText("Rectangle tool")).toBeTruthy();
    expect(screen.getByText("Circle tool")).toBeTruthy();
    expect(screen.getByText("Arrow / Connector tool")).toBeTruthy();
    expect(screen.getByText("Line tool")).toBeTruthy();
    expect(screen.getByText("Frame tool")).toBeTruthy();
  });

  it("displays all action shortcuts", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTitle("Keyboard shortcuts (?)"));

    expect(screen.getByText("Delete selected objects")).toBeTruthy();
    expect(screen.getByText("Return to Select tool")).toBeTruthy();
    expect(screen.getByText("Undo")).toBeTruthy();
    expect(screen.getByText("Redo")).toBeTruthy();
    expect(screen.getByText("Redo (alternate)")).toBeTruthy();
    expect(screen.getByText("Copy selected")).toBeTruthy();
    expect(screen.getByText("Paste")).toBeTruthy();
    expect(screen.getByText("Duplicate selected")).toBeTruthy();
  });

  it("displays navigation and editing shortcuts", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTitle("Keyboard shortcuts (?)"));

    expect(screen.getAllByText("Pan canvas").length).toBe(2);
    expect(screen.getByText("Zoom in / out")).toBeTruthy();
    expect(screen.getByText("Edit text on object")).toBeTruthy();
    expect(screen.getByText("Toggle this help panel")).toBeTruthy();
  });

  it("includes creating and connector discoverability hints", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTitle("Keyboard shortcuts (?)"));

    expect(screen.getByText("Draw shape / sticky to size")).toBeTruthy();
    expect(screen.getByText("Place default-sized object")).toBeTruthy();
    expect(screen.getByText("Snap rotation to 15°")).toBeTruthy();

    expect(screen.getByText("Connect with arrow")).toBeTruthy();
    expect(screen.getByText("Select connector (then Delete)")).toBeTruthy();
  });

  it("shows correct key bindings for non-Mac", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTitle("Keyboard shortcuts (?)"));

    const nonMacShortcuts = getShortcuts(false);
    const keyDescPairs = nonMacShortcuts
      .filter((s): s is { key: string; desc: string } => "key" in s && "desc" in s);

    // Ctrl shortcuts should use "Ctrl" not "⌘"
    const undoEntry = keyDescPairs.find((s) => s.desc === "Undo");
    expect(undoEntry?.key).toBe("Ctrl + Z");

    const redoEntry = keyDescPairs.find((s) => s.desc === "Redo");
    expect(redoEntry?.key).toBe("Ctrl + Shift + Z");
  });

  it("shows correct key bindings for Mac", () => {
    const macShortcuts = getShortcuts(true);
    const keyDescPairs = macShortcuts
      .filter((s): s is { key: string; desc: string } => "key" in s && "desc" in s);

    const undoEntry = keyDescPairs.find((s) => s.desc === "Undo");
    expect(undoEntry?.key).toBe("⌘ + Z");

    const redoEntry = keyDescPairs.find((s) => s.desc === "Redo");
    expect(redoEntry?.key).toBe("⌘ + Shift + Z");

    const copyEntry = keyDescPairs.find((s) => s.desc === "Copy selected");
    expect(copyEntry?.key).toBe("⌘ + C");
  });

  it("renders section headers", () => {
    render(<HelpPanel />);
    fireEvent.click(screen.getByTitle("Keyboard shortcuts (?)"));

    expect(screen.getByText("Tools")).toBeTruthy();
    expect(screen.getByText("Actions")).toBeTruthy();
    expect(screen.getByText("Creating")).toBeTruthy();
    expect(screen.getByText("Navigation")).toBeTruthy();
    expect(screen.getByText("Editing")).toBeTruthy();
    expect(screen.getByText("Connectors")).toBeTruthy();
  });
});
