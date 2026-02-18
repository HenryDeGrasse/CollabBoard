import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toolbar } from "../../components/toolbar/Toolbar";

describe("Toolbar integration", () => {
  it("changes tool when tool button is clicked", async () => {
    const user = userEvent.setup();
    const onToolChange = vi.fn();

    render(
      <Toolbar
        activeTool="select"
        activeColor="#FBBF24"
        selectedCount={0}
        selectedColor=""
        onToolChange={onToolChange}
        onColorChange={vi.fn()}
        onChangeSelectedColor={vi.fn()}
      />
    );

    await user.click(screen.getByTitle("Sticky Note (S)"));
    expect(onToolChange).toHaveBeenCalledWith("sticky");
  });

  it("shows creation color dropdown for creation tools and applies color", async () => {
    const user = userEvent.setup();
    const onColorChange = vi.fn();

    render(
      <Toolbar
        activeTool="sticky"
        activeColor="#FBBF24"
        selectedCount={0}
        selectedColor=""
        onToolChange={vi.fn()}
        onColorChange={onColorChange}
        onChangeSelectedColor={vi.fn()}
      />
    );

    await user.click(screen.getByTitle("Default color"));
    await user.click(screen.getByTitle("#F472B6"));

    expect(onColorChange).toHaveBeenCalledWith("#F472B6");
  });

  it("shows selected-object color dropdown in select mode", async () => {
    const user = userEvent.setup();
    const onChangeSelectedColor = vi.fn();

    render(
      <Toolbar
        activeTool="select"
        activeColor="#FBBF24"
        selectedCount={2}
        selectedColor="#3B82F6"
        onToolChange={vi.fn()}
        onColorChange={vi.fn()}
        onChangeSelectedColor={onChangeSelectedColor}
      />
    );

    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    await user.click(screen.getByTitle("Fill color"));
    await user.click(screen.getByTitle("#22C55E"));

    expect(onChangeSelectedColor).toHaveBeenCalledWith("#22C55E");
  });
});
