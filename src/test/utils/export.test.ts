import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportAsPNG, exportAsSVG, exportAsJSON } from "../../utils/export";
import type { BoardObject, Connector } from "../../types/board";

// ── Helpers ──────────────────────────────────────────────────

function makeStubAnchor() {
  return { href: "", download: "", click: vi.fn() } as unknown as HTMLAnchorElement;
}

function makeMockStage(overrides: Record<string, any> = {}) {
  return {
    toDataURL: vi.fn(() => "data:image/png;base64,AAAA"),
    width: vi.fn(() => 800),
    height: vi.fn(() => 600),
    ...overrides,
  } as any;
}

const sampleObjects: Record<string, BoardObject> = {
  obj1: {
    id: "obj1",
    type: "sticky",
    x: 10,
    y: 20,
    width: 150,
    height: 150,
    color: "#FFD700",
    text: "Hello",
    rotation: 0,
    zIndex: 1,
    createdBy: "user1",
    createdAt: 1000,
    updatedAt: 2000,
  },
};

const sampleConnectors: Record<string, Connector> = {
  conn1: {
    id: "conn1",
    fromId: "obj1",
    toId: "",
    style: "arrow",
    toPoint: { x: 100, y: 200 },
  },
};

// ── Setup / teardown ─────────────────────────────────────────

let stubAnchor: ReturnType<typeof makeStubAnchor>;
let createElementSpy: ReturnType<typeof vi.spyOn>;
let appendChildSpy: ReturnType<typeof vi.spyOn>;
let removeChildSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stubAnchor = makeStubAnchor();
  createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "a") return stubAnchor;
    if (tag === "canvas") {
      const cvs = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({
          fillStyle: "",
          fillRect: vi.fn(),
          drawImage: vi.fn(),
        })),
        toBlob: vi.fn((cb: (b: Blob | null) => void) => {
          cb(new Blob(["png-data"], { type: "image/png" }));
        }),
      };
      return cvs as any;
    }
    return document.createElementNS("http://www.w3.org/1999/xhtml", tag) as any;
  });
  appendChildSpy = vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
  removeChildSpy = vi.spyOn(document.body, "removeChild").mockImplementation((n) => n);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────

describe("exportAsPNG", () => {
  it("calls stage.toDataURL with pixelRatio 2", () => {
    const stage = makeMockStage();
    exportAsPNG(stage);
    expect(stage.toDataURL).toHaveBeenCalledWith({ pixelRatio: 2 });
  });

  it("composites onto white background and triggers download", () => {
    const stage = makeMockStage();
    // Manually trigger the Image onload
    const origImage = globalThis.Image;
    let onloadCb: (() => void) | null = null;
    globalThis.Image = class {
      src = "";
      width = 100;
      height = 100;
      set onload(cb: () => void) { onloadCb = cb; }
    } as any;

    exportAsPNG(stage, "test.png");
    // Trigger the image load
    onloadCb?.();

    expect(stubAnchor.download).toBe("test.png");
    expect(stubAnchor.click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    globalThis.Image = origImage;
  });
});

describe("exportAsSVG", () => {
  it("uses stage.toSVG when available", () => {
    const svgString = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const stage = makeMockStage({ toSVG: vi.fn(() => svgString) });

    exportAsSVG(stage, "test.svg");

    expect(stage.toSVG).toHaveBeenCalled();
    expect(stubAnchor.download).toBe("test.svg");
    expect(stubAnchor.click).toHaveBeenCalled();
  });

  it("falls back to PNG-in-SVG when toSVG is not available", () => {
    const stage = makeMockStage(); // no toSVG

    exportAsSVG(stage, "fallback.svg");

    expect(stage.toDataURL).toHaveBeenCalledWith({ pixelRatio: 2 });
    expect(stage.width).toHaveBeenCalled();
    expect(stage.height).toHaveBeenCalled();
    expect(stubAnchor.download).toBe("fallback.svg");
    expect(stubAnchor.click).toHaveBeenCalled();
  });
});

describe("exportAsJSON", () => {
  it("serializes objects and connectors into JSON and triggers download", () => {
    exportAsJSON(sampleObjects, sampleConnectors, "My Board", "export.json");

    expect(stubAnchor.download).toBe("export.json");
    expect(stubAnchor.click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("includes boardTitle, exportedAt, objects array, and connectors array", () => {
    // Capture the Blob that was passed to createObjectURL
    let capturedBlob: Blob | null = null;
    (URL.createObjectURL as any).mockImplementation((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });

    exportAsJSON(sampleObjects, sampleConnectors, "Test Board");

    expect(capturedBlob).not.toBeNull();
    // Read blob content
    return (capturedBlob as unknown as Blob).text().then((text: string) => {
      const data = JSON.parse(text);
      expect(data.boardTitle).toBe("Test Board");
      expect(data.exportedAt).toBeDefined();
      expect(Array.isArray(data.objects)).toBe(true);
      expect(data.objects).toHaveLength(1);
      expect(data.objects[0].id).toBe("obj1");
      expect(Array.isArray(data.connectors)).toBe(true);
      expect(data.connectors).toHaveLength(1);
      expect(data.connectors[0].id).toBe("conn1");
    });
  });

  it("uses default filename when none is provided", () => {
    exportAsJSON(sampleObjects, sampleConnectors, "Board");
    expect(stubAnchor.download).toBe("board.json");
  });
});
