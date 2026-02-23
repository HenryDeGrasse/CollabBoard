/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  isUuid,
  isInProgressStatus,
  isTerminalStatus,
  isStaleRun,
  replayStoredResponse,
  type AiRunRow,
} from "../../../api/_lib/aiRuns";

function makeRun(overrides: Partial<AiRunRow> = {}): AiRunRow {
  return {
    id: "run-1",
    board_id: "board-1",
    user_id: "user-1",
    command_id: "123e4567-e89b-12d3-a456-426614174000",
    command: "Add notes",
    status: "completed",
    model: "gpt-4.1-mini",
    tool_calls_count: 1,
    current_step: 1,
    total_steps: 1,
    board_version_start: 0,
    board_version_end: 1,
    duration_ms: 100,
    response: null,
    plan_json: null,
    created_at: new Date().toISOString(),
    ...overrides,
  } as AiRunRow;
}

describe("aiRuns helpers", () => {
  describe("isUuid", () => {
    it("accepts v4 UUID", () => {
      expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    });

    it("accepts crypto.randomUUID() output", () => {
      expect(isUuid(crypto.randomUUID())).toBe(true);
    });

    it("rejects non-UUID strings", () => {
      expect(isUuid("not-a-uuid")).toBe(false);
      expect(isUuid("")).toBe(false);
    });
  });

  describe("status classification", () => {
    it("classifies in-progress statuses", () => {
      expect(isInProgressStatus("executing")).toBe(true);
      expect(isInProgressStatus("started")).toBe(true);
      expect(isInProgressStatus("resuming")).toBe(true);
      expect(isInProgressStatus("completed")).toBe(false);
      expect(isInProgressStatus("failed")).toBe(false);
    });

    it("classifies terminal statuses", () => {
      expect(isTerminalStatus("completed")).toBe(true);
      expect(isTerminalStatus("failed")).toBe(true);
      expect(isTerminalStatus("needs_confirmation")).toBe(true);
      expect(isTerminalStatus("started")).toBe(false);
    });
  });

  describe("isStaleRun", () => {
    it("returns false for terminal runs", () => {
      const run = makeRun({ status: "completed" });
      expect(isStaleRun(run)).toBe(false);
    });

    it("returns false for recent in-progress runs", () => {
      const run = makeRun({
        status: "executing",
        created_at: new Date().toISOString(),
      });
      expect(isStaleRun(run)).toBe(false);
    });

    it("returns true for old in-progress runs", () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const run = makeRun({
        status: "executing",
        created_at: tenMinutesAgo,
      });
      expect(isStaleRun(run)).toBe(true);
    });
  });

  describe("replayStoredResponse", () => {
    it("replays complete response payload as SSE events", () => {
      const run = makeRun({
        response: {
          meta: { model: "gpt-4.1-mini", complexity: "simple" },
          plan: { steps: [{ id: "s1" }] },
          responseText: "Done!",
        },
      });

      const events = replayStoredResponse(run);
      expect(events.map((e) => e.type)).toEqual([
        "meta",
        "plan_ready",
        "text",
        "done",
      ]);
      expect(events[2].content).toBe("Done!");
    });

    it("includes error event for failed runs", () => {
      const run = makeRun({
        status: "failed",
        response: { error: "Something broke", responseText: "partial" },
      });

      const events = replayStoredResponse(run);
      const types = events.map((e) => e.type);
      expect(types).toContain("error");
      expect(types).toContain("text");
      expect(types).toContain("done");
    });

    it("handles null/missing response gracefully", () => {
      const run = makeRun({ response: null });
      const events = replayStoredResponse(run);
      expect(events).toEqual([{ type: "done", content: "" }]);
    });
  });
});
