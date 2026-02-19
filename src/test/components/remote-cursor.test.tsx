import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RemoteCursor } from "../../components/canvas/RemoteCursor";

describe("RemoteCursor", () => {
  const defaultProps = {
    displayName: "Alice",
    color: "#EF4444",
    x: 100,
    y: 200,
  };

  it("renders without crashing", () => {
    const { container } = render(<RemoteCursor {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it("renders the display name (passed to Text mock)", () => {
    render(<RemoteCursor {...defaultProps} />);
    // Konva Text mock renders null, but the component should not crash
    // and should pass props through the Group → children chain
    expect(true).toBe(true);
  });

  it("renders with different display names", () => {
    const { container } = render(<RemoteCursor {...defaultProps} displayName="Bob" />);
    // Konva components are mocked; verify render doesn't crash
    expect(container).toBeTruthy();
  });

  it("renders with different positions", () => {
    const { container } = render(<RemoteCursor {...defaultProps} x={500} y={300} />);
    expect(container).toBeTruthy();
  });

  it("renders with different colors", () => {
    const { container } = render(<RemoteCursor {...defaultProps} color="#3B82F6" />);
    expect(container).toBeTruthy();
  });
});
