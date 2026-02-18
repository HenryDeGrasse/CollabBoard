/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { decideIntentRoute, parseFastPath } from "../../../api/_lib/ai/intentEngine";

describe("intentEngine", () => {
  it("parses deterministic sticky batch command", () => {
    const match = parseFastPath("Create 5 sticky notes about roadmap");
    expect(match).toEqual({
      kind: "create_sticky_batch",
      count: 5,
      topic: "roadmap",
      color: undefined,
    });
  });

  it("parses delete by type", () => {
    const match = parseFastPath("Delete all rectangles");
    expect(match).toEqual({ kind: "delete_by_type", objectType: "rectangle" });
  });

  it("routes regex matches to fast_path with high confidence", () => {
    const decision = decideIntentRoute("Delete all sticky notes", "delete");
    expect(decision.source).toBe("fast_path");
    expect(decision.confidence).toBeGreaterThan(0.9);
    expect(decision.reason).toContain("regex_match");
  });

  it("routes simple unmatched commands to ai_extractor", () => {
    const decision = decideIntentRoute(
      "please put a handful of quick thoughts on the board",
      "create_simple"
    );
    expect(decision.source).toBe("ai_extractor");
    expect(decision.match).toBeNull();
  });

  it("routes complex commands to full_agent", () => {
    const decision = decideIntentRoute(
      "create a strategy doc and reorganize everything and connect the themes and rewrite all text and sort by priority and map dependencies",
      "general"
    );
    expect(decision.source).toBe("full_agent");
  });
});
