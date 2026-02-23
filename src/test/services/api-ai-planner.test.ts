/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  createExecutionPlan,
  validateExecutionPlan,
} from "../../../api/_lib/aiPlanner";

describe("createExecutionPlan", () => {
  it("creates a template-oriented plan for layout commands", () => {
    const plan = createExecutionPlan({
      command: "Create a mind map for roadmap planning",
      complexity: "complex",
      selectedCount: 0,
      hasFastPath: false,
      toolNames: ["createMindMap", "search_objects", "get_board_context"],
    });

    expect(plan.intent).toBe("template");
    expect(plan.requiresRead).toBe(true);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("marks destructive language as high risk", () => {
    const plan = createExecutionPlan({
      command: "Clear board and start over",
      complexity: "simple",
      selectedCount: 0,
      hasFastPath: false,
      toolNames: ["clear_board", "read_board_state"],
    });

    expect(plan.riskLevel).toBe("high");
  });
});

describe("validateExecutionPlan", () => {
  it("accepts valid plans", () => {
    const plan = createExecutionPlan({
      command: "Add 3 sticky notes",
      complexity: "simple",
      selectedCount: 0,
      hasFastPath: false,
      toolNames: ["create_objects", "search_objects", "get_board_context"],
    });

    expect(validateExecutionPlan(plan)).toEqual({ valid: true });
  });

  it("rejects high-risk plan when clear_board is not available", () => {
    const result = validateExecutionPlan({
      intent: "edit",
      requiresRead: false,
      estimatedOps: 1,
      riskLevel: "high",
      steps: [{ id: "mutate", label: "Mutate", kind: "mutate" }],
      // Has delete_objects but NOT clear_board — still rejected for high risk.
      tools: ["create_objects", "delete_objects"],
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PLAN_RISK_MISMATCH");
    }
  });

  it("accepts high-risk plan when clear_board is available", () => {
    const result = validateExecutionPlan({
      intent: "edit",
      requiresRead: false,
      estimatedOps: 1,
      riskLevel: "high",
      steps: [{ id: "mutate", label: "Mutate", kind: "mutate" }],
      tools: ["clear_board"],
    });

    expect(result.valid).toBe(true);
  });
});
