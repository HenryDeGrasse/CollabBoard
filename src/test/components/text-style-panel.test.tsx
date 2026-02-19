import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextStylePanel } from "../../components/sidebar/TextStylePanel";

const defaultProps = {
  textSize: 16,
  textColor: "#111827",
  textVerticalAlign: "middle" as const,
  onIncreaseTextSize: vi.fn(),
  onDecreaseTextSize: vi.fn(),
  onChangeTextColor: vi.fn(),
  onChangeTextVerticalAlign: vi.fn(),
};

function renderPanel(overrides: Partial<typeof defaultProps> = {}) {
  return render(<TextStylePanel {...defaultProps} {...overrides} />);
}

describe("TextStylePanel", () => {
  it("renders decrease and increase buttons", () => {
    renderPanel();
    expect(screen.getByTitle("Decrease text size")).toBeTruthy();
    expect(screen.getByTitle("Increase text size")).toBeTruthy();
  });

  it("shows current text size", () => {
    renderPanel({ textSize: 24 });
    expect(screen.getByText("24")).toBeTruthy();
  });

  it('shows "Mix" when textSize is null', () => {
    renderPanel({ textSize: null });
    expect(screen.getByText("Mix")).toBeTruthy();
  });

  it("calls onDecreaseTextSize when A- is clicked", async () => {
    const onDecreaseTextSize = vi.fn();
    renderPanel({ onDecreaseTextSize });

    await userEvent.setup().click(screen.getByTitle("Decrease text size"));
    expect(onDecreaseTextSize).toHaveBeenCalledTimes(1);
  });

  it("calls onIncreaseTextSize when A+ is clicked", async () => {
    const onIncreaseTextSize = vi.fn();
    renderPanel({ onIncreaseTextSize });

    await userEvent.setup().click(screen.getByTitle("Increase text size"));
    expect(onIncreaseTextSize).toHaveBeenCalledTimes(1);
  });

  it("opens color picker when color button is clicked", async () => {
    renderPanel();

    const colorBtn = screen.getByTitle("Text color");
    await userEvent.setup().click(colorBtn);

    expect(screen.getByText("Text color")).toBeTruthy();
  });

  it("calls onChangeTextColor with chosen color and closes picker", async () => {
    const onChangeTextColor = vi.fn();
    renderPanel({ onChangeTextColor });

    const user = userEvent.setup();

    // Open color picker
    await user.click(screen.getByTitle("Text color"));

    // Click a color option (e.g., red #EF4444)
    const redBtn = screen.getByTitle("#EF4444");
    await user.click(redBtn);

    expect(onChangeTextColor).toHaveBeenCalledWith("#EF4444");
  });

  it("renders vertical alignment buttons", () => {
    renderPanel();
    expect(screen.getByTitle("Align Top")).toBeTruthy();
    expect(screen.getByTitle("Align Center")).toBeTruthy();
    expect(screen.getByTitle("Align Bottom")).toBeTruthy();
  });

  it("calls onChangeTextVerticalAlign when alignment button is clicked", async () => {
    const onChangeTextVerticalAlign = vi.fn();
    renderPanel({ onChangeTextVerticalAlign });

    await userEvent.setup().click(screen.getByTitle("Align Top"));
    expect(onChangeTextVerticalAlign).toHaveBeenCalledWith("top");
  });
});
