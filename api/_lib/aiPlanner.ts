export type PlanRiskLevel = "low" | "medium" | "high";

export interface ExecutionPlanStep {
  id: string;
  label: string;
  kind: "read" | "mutate" | "summarize";
}

export interface ExecutionPlan {
  intent: "template" | "create" | "edit" | "search" | "mixed";
  requiresRead: boolean;
  estimatedOps: number;
  riskLevel: PlanRiskLevel;
  steps: ExecutionPlanStep[];
  tools: string[];
}

interface CreatePlanInput {
  command: string;
  complexity: "simple" | "complex";
  selectedCount: number;
  toolNames: string[];
  hasFastPath: boolean;
}

const DESTRUCTIVE_KEYWORDS = [
  "delete all",
  "clear",
  "wipe",
  "remove everything",
  "start over",
  "empty board",
];

const READ_KEYWORDS = [
  "find",
  "search",
  "where",
  "which",
  "organize",
  "reorganize",
  "categorize",
  "sort",
  "group",
  "selected",
  "these",
  "those",
  "them",
];

export function createExecutionPlan(input: CreatePlanInput): ExecutionPlan {
  const lower = input.command.toLowerCase();
  const hasDestructive = DESTRUCTIVE_KEYWORDS.some((kw) => lower.includes(kw));
  const hasReadLanguage = READ_KEYWORDS.some((kw) => lower.includes(kw));
  const usesLayoutTools = input.toolNames.some((name) =>
    [
      "createQuadrant",
      "createColumnLayout",
      "createMindMap",
      "createFlowchart",
      "createWireframe",
    ].includes(name)
  );

  const requiresRead =
    !input.hasFastPath &&
    (hasReadLanguage || input.selectedCount > 0 || usesLayoutTools || input.complexity === "complex");

  let intent: ExecutionPlan["intent"] = "mixed";
  if (input.hasFastPath || usesLayoutTools) intent = "template";
  else if (lower.includes("search") || lower.includes("find")) intent = "search";
  else if (lower.includes("create") || lower.includes("add") || lower.includes("make")) intent = "create";
  else if (lower.includes("update") || lower.includes("edit") || lower.includes("rename") || lower.includes("delete")) intent = "edit";

  const steps: ExecutionPlanStep[] = [];
  if (requiresRead) {
    steps.push({ id: "read-context", label: "Read scoped board context", kind: "read" });
  }
  steps.push({ id: "apply-mutations", label: "Execute board changes", kind: "mutate" });
  steps.push({ id: "summarize", label: "Summarize results", kind: "summarize" });

  return {
    intent,
    requiresRead,
    estimatedOps: input.complexity === "complex" ? 3 : 1,
    riskLevel: hasDestructive ? "high" : input.complexity === "complex" ? "medium" : "low",
    steps,
    tools: input.toolNames,
  };
}

export function validateExecutionPlan(plan: ExecutionPlan): { valid: true } | { valid: false; code: string; message: string } {
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { valid: false, code: "PLAN_EMPTY", message: "Execution plan must include at least one step." };
  }

  if (plan.estimatedOps < 1 || plan.estimatedOps > 20) {
    return { valid: false, code: "PLAN_BUDGET", message: "Execution plan operation budget is out of bounds." };
  }

  // High-risk commands (clear/wipe/delete-all) must have clear_board available.
  // delete_objects alone is not sufficient for a board-wide wipe because it
  // requires explicit IDs — clear_board is the correct tool for blanket deletes.
  if (plan.riskLevel === "high" && !plan.tools.includes("clear_board")) {
    return { valid: false, code: "PLAN_RISK_MISMATCH", message: "High-risk plan requires clear_board tool but it is not available." };
  }

  return { valid: true };
}
