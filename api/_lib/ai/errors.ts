/**
 * Structured error types for the AI agent pipeline.
 *
 * Every error has a machine-readable code, a human message,
 * and optionally a suggested fix so the auto-repair loop
 * can attempt recovery.
 */

export type ErrorCode =
  | "object_not_found"
  | "frame_not_found"
  | "invalid_parent"
  | "invalid_type"
  | "invalid_color"
  | "budget_exceeded"
  | "timeout"
  | "openai_error"
  | "plan_invalid"
  | "plan_validation_failed"
  | "template_not_found"
  | "db_error"
  | "unknown";

export interface StructuredError {
  code: ErrorCode;
  message: string;
  details?: Record<string, any>;
  suggestedFix?: string;
  retryable: boolean;
}

export function makeError(
  code: ErrorCode,
  message: string,
  opts?: { details?: Record<string, any>; suggestedFix?: string; retryable?: boolean }
): StructuredError {
  return {
    code,
    message,
    details: opts?.details,
    suggestedFix: opts?.suggestedFix,
    retryable: opts?.retryable ?? false,
  };
}

// ─── Common Errors ────────────────────────────────────────────

export const Errors = {
  objectNotFound: (id: string) =>
    makeError("object_not_found", `Object not found: ${id}`, {
      details: { objectId: id },
      suggestedFix: "Use getBoardContext to verify the object exists",
    }),

  frameNotFound: (id: string) =>
    makeError("frame_not_found", `Frame not found: ${id}`, {
      details: { frameId: id },
      suggestedFix: "Use getBoardContext with scope 'all' and typeFilter 'frame' to find available frames",
    }),

  invalidParent: (objectId: string, currentParent: string | null, targetParent: string) =>
    makeError("invalid_parent", "Object already belongs to another frame", {
      details: { objectId, currentParent, targetParent },
      suggestedFix: "Call removeObjectFromFrame first, then addObjectToFrame",
    }),

  budgetExceeded: (what: string, current: number, max: number) =>
    makeError("budget_exceeded", `${what}: ${current} exceeds max ${max}`, {
      details: { what, current, max },
      retryable: false,
    }),

  timeout: (ms: number) =>
    makeError("timeout", `Operation timed out after ${ms}ms`, {
      details: { timeoutMs: ms },
      retryable: true,
    }),

  planInvalid: (reason: string) =>
    makeError("plan_invalid", `Plan is invalid: ${reason}`, {
      suggestedFix: "Regenerate the plan with simpler operations",
      retryable: true,
    }),

  templateNotFound: (id: string) =>
    makeError("template_not_found", `Unknown template: ${id}`, {
      details: { templateId: id },
    }),

  dbError: (message: string) =>
    makeError("db_error", `Database error: ${message}`, { retryable: true }),
};
