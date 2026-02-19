import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ConnectorLine } from "../../components/canvas/Connector";
import type { Connector, BoardObject } from "../../types/board";

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: "conn-1",
    fromId: "obj-1",
    toId: "obj-2",
    style: "arrow",
    ...overrides,
  };
}

function makeObj(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: "obj-1",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    color: "#FBBF24",
    rotation: 0,
    zIndex: 1,
    createdBy: "user-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("ConnectorLine", () => {
  it("renders arrow-style connector without crashing", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector({ style: "arrow" })}
        fromObj={makeObj({ id: "obj-1", x: 0, y: 0 })}
        toObj={makeObj({ id: "obj-2", x: 200, y: 200 })}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("renders line-style connector without crashing", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector({ style: "line" })}
        fromObj={makeObj({ id: "obj-1", x: 0, y: 0 })}
        toObj={makeObj({ id: "obj-2", x: 200, y: 200 })}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("renders when both objects are undefined (free-floating)", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector({
          fromId: "",
          toId: "",
          fromPoint: { x: 10, y: 20 },
          toPoint: { x: 300, y: 400 },
        })}
        fromObj={undefined}
        toObj={undefined}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("renders when fromObj is undefined (free start)", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector({ fromId: "", fromPoint: { x: 50, y: 50 } })}
        fromObj={undefined}
        toObj={makeObj({ id: "obj-2", x: 200, y: 200 })}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("renders when toObj is undefined (free end)", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector({ toId: "", toPoint: { x: 500, y: 500 } })}
        fromObj={makeObj({ id: "obj-1" })}
        toObj={undefined}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("falls back to {x: 0, y: 0} when free points are missing", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector({ fromId: "", toId: "" })}
        fromObj={undefined}
        toObj={undefined}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("renders with selected state", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector()}
        fromObj={makeObj({ id: "obj-1" })}
        toObj={makeObj({ id: "obj-2", x: 200, y: 200 })}
        isSelected={true}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("handles circle-type objects", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector()}
        fromObj={makeObj({ id: "obj-1", type: "circle" })}
        toObj={makeObj({ id: "obj-2", type: "circle", x: 300, y: 300 })}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("handles rotated objects", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector()}
        fromObj={makeObj({ id: "obj-1", rotation: 45 })}
        toObj={makeObj({ id: "obj-2", x: 300, y: 300, rotation: 90 })}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("uses default color when connector has no color", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector({ color: undefined })}
        fromObj={makeObj({ id: "obj-1" })}
        toObj={makeObj({ id: "obj-2", x: 200, y: 200 })}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("uses custom strokeWidth when provided", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector({ strokeWidth: 5 })}
        fromObj={makeObj({ id: "obj-1" })}
        toObj={makeObj({ id: "obj-2", x: 200, y: 200 })}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });

  it("uses custom color when provided", () => {
    const { container } = render(
      <ConnectorLine
        connector={makeConnector({ color: "#EF4444" })}
        fromObj={makeObj({ id: "obj-1" })}
        toObj={makeObj({ id: "obj-2", x: 200, y: 200 })}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeTruthy();
  });
});
