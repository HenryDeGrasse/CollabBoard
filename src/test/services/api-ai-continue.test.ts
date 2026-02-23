/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyToken = vi.fn().mockResolvedValue("user-1");
const mockAssertCanWriteBoard = vi.fn().mockResolvedValue(undefined);
const mockFindAiRun = vi.fn();
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
  hasFastPathMatch: () => false,
  runAgent: async function* () {
    yield { type: "text", content: "Resumed!" };
    yield { type: "done", content: "" };
  },
}));

vi.mock("../../../api/_lib/aiTools.js", () => ({
  fetchBoardState: vi.fn().mockResolvedValue({ objectCount: 0, connectorCount: 0, objects: [], connectors: [] }),
}));

vi.mock("../../../api/_lib/aiRuns.js", async () => {
  const actual = await vi.importActual<any>("../../../api/_lib/aiRuns.js");
  return {
    ...actual,
    findAiRun: (...args: any[]) => mockFindAiRun(...args),
    recoverStaleRun: (...args: any[]) => mockRecoverStaleRun(...args),
    updateAiRun: vi.fn().mockResolvedValue(undefined),
    markAiRunCompleted: vi.fn().mockResolvedValue(undefined),
    markAiRunFailed: vi.fn().mockResolvedValue(undefined),
  };
});

import handler from "../../../api/ai-continue";

function createReq(overrides: Partial<any> = {}): any {
  return {
    method: "POST",
    headers: { authorization: "Bearer tok" },
    body: {
      boardId: "board-1",
      commandId: "123e4567-e89b-12d3-a456-426614174000",
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

function makeRun(overrides: Partial<any> = {}) {
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
    response: {
      meta: { model: "gpt-4.1-mini", complexity: "simple" },
      responseText: "Done!",
    },
    plan_json: { request: {} },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("POST /api/ai-continue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    mockRecoverStaleRun.mockImplementation((run: any) => Promise.resolve(run));
  });

  it("replays completed run response via SSE", async () => {
    mockFindAiRun.mockResolvedValue(makeRun({ status: "completed" }));

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.chunks.join("")).toContain("\"type\":\"text\"");
    expect(res.chunks.join("")).toContain("Done!");
    expect(res.chunks.join("")).toContain("[DONE]");
  });

  it("returns 400 for invalid commandId", async () => {
    const req = createReq({ body: { boardId: "board-1", commandId: "invalid" } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "commandId must be a valid UUID" });
  });

  it("returns 403 when user doesn't own the run", async () => {
    mockFindAiRun.mockResolvedValue(makeRun({ user_id: "other-user" }));

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Not authorized to access this run" });
  });

  it("resumes a failed run from stored context", async () => {
    const failedRun = makeRun({
      status: "failed",
      response: { error: "Previous failure" },
      plan_json: { request: { conversationHistory: [] } },
    });
    mockFindAiRun.mockResolvedValue(failedRun);

    const req = createReq();
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    expect(res.chunks.join("")).toContain("Resumed!");
  });
});
