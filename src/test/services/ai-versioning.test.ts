/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();

const mockBoardsSingle = vi.fn();
const mockObjectsMaybeSingle = vi.fn();
const mockObjectsSingle = vi.fn();
const mockObjectsInsert = vi.fn();
const mockObjectsInsertSingle = vi.fn();
const mockAiRunsUpdate = vi.fn();
const mockAiRunsUpdateEqBoard = vi.fn();
const mockAiRunsUpdateEqCommand = vi.fn();
const mockAiRunsMaybeSingle = vi.fn();

const mockSupabase = {
  from: (...args: any[]) => mockFrom(...args),
  rpc: (...args: any[]) => mockRpc(...args),
};

vi.mock("../../../api/_lib/supabaseAdmin.js", () => ({
  getSupabaseAdmin: () => mockSupabase,
}));

import {
  checkBoardVersion,
  getBoardVersion,
  idempotentCreateObject,
  incrementBoardVersion,
  loadJob,
  updateJobProgress,
} from "../../../api/_lib/ai/versioning";

describe("AI versioning helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockImplementation((table: string) => {
      if (table === "boards") {
        return {
          select: () => ({
            eq: () => ({
              single: (...args: any[]) => mockBoardsSingle(...args),
            }),
          }),
        };
      }

      if (table === "objects") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: (...args: any[]) => mockObjectsMaybeSingle(...args),
                single: (...args: any[]) => mockObjectsSingle(...args),
              }),
            }),
          }),
          insert: (...args: any[]) => {
            mockObjectsInsert(...args);
            return {
              select: () => ({
                single: (...singleArgs: any[]) => mockObjectsInsertSingle(...singleArgs),
              }),
            };
          },
        };
      }

      if (table === "ai_runs") {
        return {
          update: (...args: any[]) => {
            mockAiRunsUpdate(...args);
            return {
              eq: (...eqBoardArgs: any[]) => {
                mockAiRunsUpdateEqBoard(...eqBoardArgs);
                return {
                  eq: (...eqCmdArgs: any[]) => {
                    mockAiRunsUpdateEqCommand(...eqCmdArgs);
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: (...args: any[]) => mockAiRunsMaybeSingle(...args),
              }),
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it("returns current board version", async () => {
    mockBoardsSingle.mockResolvedValue({ data: { version: 7 }, error: null });

    await expect(getBoardVersion("board-1")).resolves.toBe(7);
  });

  it("defaults board version to 0 when missing", async () => {
    mockBoardsSingle.mockResolvedValue({ data: null, error: null });

    await expect(getBoardVersion("board-1")).resolves.toBe(0);
  });

  it("increments board version via RPC", async () => {
    mockRpc.mockResolvedValue({ data: 8, error: null });

    await expect(incrementBoardVersion("board-1")).resolves.toBe(8);
    expect(mockRpc).toHaveBeenCalledWith("increment_board_version", {
      p_board_id: "board-1",
    });
  });

  it("detects board version conflicts", async () => {
    mockBoardsSingle.mockResolvedValue({ data: { version: 10 }, error: null });

    await expect(checkBoardVersion("board-1", 10)).resolves.toEqual({ ok: true });
    await expect(checkBoardVersion("board-1", 9)).resolves.toEqual({
      ok: false,
      currentVersion: 10,
    });
  });

  it("idempotently returns existing object for same client_id", async () => {
    mockObjectsMaybeSingle.mockResolvedValue({ data: { id: "obj-existing" }, error: null });

    const result = await idempotentCreateObject("board-1", "client-1", { type: "sticky" });

    expect(result).toEqual({ id: "obj-existing", alreadyExisted: true });
    expect(mockObjectsInsert).not.toHaveBeenCalled();
  });

  it("creates object when client_id does not exist", async () => {
    mockObjectsMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockObjectsInsertSingle.mockResolvedValue({ data: { id: "obj-new" }, error: null });

    const result = await idempotentCreateObject("board-1", "client-2", {
      type: "sticky",
      x: 10,
    });

    expect(result).toEqual({ id: "obj-new", alreadyExisted: false });
    expect(mockObjectsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        board_id: "board-1",
        client_id: "client-2",
        type: "sticky",
        x: 10,
      })
    );
  });

  it("handles race condition on unique constraint by returning raced row", async () => {
    mockObjectsMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockObjectsInsertSingle.mockResolvedValue({
      data: null,
      error: { code: "23505" },
    });
    mockObjectsSingle.mockResolvedValue({ data: { id: "obj-raced" }, error: null });

    const result = await idempotentCreateObject("board-1", "client-3", { type: "sticky" });

    expect(result).toEqual({ id: "obj-raced", alreadyExisted: true });
  });

  it("updates only provided ai_run fields", async () => {
    await updateJobProgress("board-1", "cmd-1", {
      status: "executing",
      currentStep: 2,
      boardVersionStart: 5,
      response: { progress: "step 2" },
    });

    expect(mockAiRunsUpdate).toHaveBeenCalledWith({
      status: "executing",
      current_step: 2,
      board_version_start: 5,
      response: { progress: "step 2" },
    });
    expect(mockAiRunsUpdateEqBoard).toHaveBeenCalledWith("board_id", "board-1");
    expect(mockAiRunsUpdateEqCommand).toHaveBeenCalledWith("command_id", "cmd-1");
  });

  it("is no-op when updateJobProgress receives empty updates", async () => {
    await updateJobProgress("board-1", "cmd-1", {});
    expect(mockAiRunsUpdate).not.toHaveBeenCalled();
  });

  it("loads resumable job payload and normalizes nullable fields", async () => {
    mockAiRunsMaybeSingle.mockResolvedValue({
      data: {
        status: "resuming",
        current_step: null,
        total_steps: 4,
        board_version_start: 12,
        plan_json: { steps: [1, 2] },
        command: "create kanban",
      },
      error: null,
    });

    await expect(loadJob("board-1", "cmd-1")).resolves.toEqual({
      status: "resuming",
      currentStep: 0,
      totalSteps: 4,
      boardVersionStart: 12,
      planJson: { steps: [1, 2] },
      command: "create kanban",
    });
  });

  it("returns null when loadJob has error or no data", async () => {
    mockAiRunsMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(loadJob("board-1", "cmd-1")).resolves.toBeNull();

    mockAiRunsMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: "bad" } });
    await expect(loadJob("board-1", "cmd-1")).resolves.toBeNull();
  });
});
