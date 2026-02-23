/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyToken = vi.fn().mockResolvedValue("user-1");
const mockAssertCanWriteBoard = vi.fn().mockResolvedValue(undefined);
const mockHasFastPathMatch = vi.fn().mockReturnValue(false);
const mockRunAgent = vi.fn();
const mockFetchBoardState = vi.fn().mockResolvedValue({ objectCount: 0, connectorCount: 0, objects: [], connectors: [] });

const mockFindAiRun = vi.fn();
const mockCreateAiRun = vi.fn();
const mockUpdateAiRun = vi.fn().mockResolvedValue(undefined);
const mockMarkAiRunCompleted = vi.fn().mockResolvedValue(undefined);
const mockMarkAiRunFailed = vi.fn().mockResolvedValue(undefined);
const mockRecoverStaleRun = vi.fn();

vi.mock("../../../api/_lib/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  assertCanWriteBoard: (...args: any[]) => mockAssertCanWriteBoard(...args),
  AuthError: class AuthError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "AuthError";
    }
  },
}));

vi.mock("../../../api/_lib/aiAgent.js", () => ({
  hasFastPathMatch: (...args: any[]) => mockHasFastPathMatch(...args),
  runAgent: (...args: any[]) => mockRunAgent(...args),
}));

vi.mock("../../../api/_lib/aiTools.js", () => ({
  fetchBoardState: (...args: any[]) => mockFetchBoardState(...args),
  checkRateLimit: () => ({ allowed: true, remaining: 19, retryAfterSeconds: 0 }),
}));

vi.mock("../../../api/_lib/aiRuns.js", async () => {
  const actual = await vi.importActual<any>("../../../api/_lib/aiRuns.js");
  return {
    ...actual,
    findAiRun: (...args: any[]) => mockFindAiRun(...args),
    createAiRun: (...args: any[]) => mockCreateAiRun(...args),
    updateAiRun: (...args: any[]) => mockUpdateAiRun(...args),
    markAiRunCompleted: (...args: any[]) => mockMarkAiRunCompleted(...args),
    markAiRunFailed: (...args: any[]) => mockMarkAiRunFailed(...args),
    recoverStaleRun: (...args: any[]) => mockRecoverStaleRun(...args),
  };
});

import handler from "../../../api/ai";

function createReq(overrides: Partial<any> = {}): any {
  return {
    method: "POST",
    headers: { authorization: "Bearer tok" },
    body: {
      boardId: "board-1",
      command: "Add 1 sticky",
    },
    ...overrides,
  };
}

function createRes(): any {
  const chunks: string[] = [];
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {} as Record<string, string>,
    chunks,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    write(chunk: string) {
      this.chunks.push(chunk);
      return true;
    },
    end() {
      return this;
    },
  };
  return res;
}

describe("POST /api/ai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";

    mockRunAgent.mockImplementation(async function* () {
      yield { type: "meta", content: JSON.stringify({ model: "gpt-4.1-mini", complexity: "simple", contextScope: "full" }) };
      yield { type: "text", content: "Done!" };
      yield { type: "done", content: "" };
    });

    mockFindAiRun.mockResolvedValue(null);
    mockRecoverStaleRun.mockImplementation((run: any) => Promise.resolve(run));
    mockCreateAiRun.mockResolvedValue({
      id: "run-1",
      board_id: "board-1",
      user_id: "user-1",
      command_id: "123e4567-e89b-12d3-a456-426614174000",
      command: "Add 1 sticky",
      status: "started",
      plan_json: { request: {} },
      response: null,
      created_at: new Date().toISOString(),
    });
  });

  it("fails fast when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "OPENAI_API_KEY not configured" });
    // Must not create an ai_run row
    expect(mockCreateAiRun).not.toHaveBeenCalled();
  });

  it("generates commandId when missing and streams SSE", async () => {
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.chunks.join("")).toContain("\"type\":\"text\"");
    expect(res.chunks.join("")).toContain("Done!");
    expect(mockCreateAiRun).toHaveBeenCalled();

    const createArg = mockCreateAiRun.mock.calls[0][0];
    expect(createArg.commandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it("returns 409 when command is already in progress", async () => {
    const inProgressRun = {
      status: "executing",
      created_at: new Date().toISOString(),
    };
    mockFindAiRun.mockResolvedValue(inProgressRun);
    mockRecoverStaleRun.mockResolvedValue(inProgressRun);

    const req = createReq({
      body: {
        boardId: "board-1",
        command: "Add 1 sticky",
        commandId: "123e4567-e89b-12d3-a456-426614174000",
      },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual(
      expect.objectContaining({
        error: "Command is already in progress",
        commandId: "123e4567-e89b-12d3-a456-426614174000",
      })
    );
  });

  it("recovers stale runs instead of returning 409", async () => {
    const staleRun = {
      status: "executing",
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };
    mockFindAiRun.mockResolvedValue(staleRun);
    // recoverStaleRun marks it as failed
    mockRecoverStaleRun.mockResolvedValue({ ...staleRun, status: "failed" });

    const req = createReq({
      body: {
        boardId: "board-1",
        command: "Add 1 sticky",
        commandId: "123e4567-e89b-12d3-a456-426614174000",
      },
    });
    const res = createRes();

    await handler(req, res);

    // Should NOT return 409 — stale run was recovered and re-executed
    expect(res.statusCode).toBe(200);
    expect(mockRecoverStaleRun).toHaveBeenCalledWith(staleRun);
    expect(mockUpdateAiRun).toHaveBeenCalled();
  });

  it("runs boardState fetch in parallel with auth check", async () => {
    const req = createReq();
    const res = createRes();

    await handler(req, res);

    // Both assertCanWriteBoard and fetchBoardState should have been called
    expect(mockAssertCanWriteBoard).toHaveBeenCalledWith("user-1", "board-1");
    expect(mockFetchBoardState).toHaveBeenCalledWith("board-1");
  });
});
