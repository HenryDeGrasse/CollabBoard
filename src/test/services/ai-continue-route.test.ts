/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyToken = vi.fn();
const mockLoadJob = vi.fn();
const mockExecuteAICommand = vi.fn();

vi.mock("../../../api/_lib/auth.js", () => {
  class AuthError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "AuthError";
    }
  }

  return {
    verifyToken: (...args: any[]) => mockVerifyToken(...args),
    AuthError,
  };
});

vi.mock("../../../api/_lib/ai/versioning.js", () => ({
  loadJob: (...args: any[]) => mockLoadJob(...args),
}));

vi.mock("../../../api/_lib/ai/agent.js", () => ({
  executeAICommand: (...args: any[]) => mockExecuteAICommand(...args),
}));

import { AuthError } from "../../../api/_lib/auth.js";
import handler from "../../../api/ai-continue";

function createRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("POST /api/ai-continue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("rejects non-POST methods", async () => {
    const req: any = { method: "GET", headers: {}, body: {} };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: "Method not allowed" });
  });

  it("returns auth error from verifyToken", async () => {
    mockVerifyToken.mockRejectedValue(new AuthError(401, "Invalid token"));

    const req: any = { method: "POST", headers: {}, body: {} };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid token" });
  });

  it("validates required payload fields", async () => {
    mockVerifyToken.mockResolvedValue("user-1");

    const req: any = { method: "POST", headers: { authorization: "Bearer x" }, body: { boardId: "b" } };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "boardId and commandId are required" });
  });

  it("returns 404 when job is missing", async () => {
    mockVerifyToken.mockResolvedValue("user-1");
    mockLoadJob.mockResolvedValue(null);

    const req: any = {
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: { boardId: "board-1", commandId: "cmd-1" },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Job not found" });
  });

  it("short-circuits when job already completed", async () => {
    mockVerifyToken.mockResolvedValue("user-1");
    mockLoadJob.mockResolvedValue({ status: "completed", command: "ignored" });

    const req: any = {
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: { boardId: "board-1", commandId: "cmd-1" },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/already completed/i);
    expect(mockExecuteAICommand).not.toHaveBeenCalled();
  });

  it("returns 500 when OpenAI key is not configured", async () => {
    mockVerifyToken.mockResolvedValue("user-1");
    delete process.env.OPENAI_API_KEY;

    const req: any = {
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: { boardId: "board-1", commandId: "cmd-1" },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "OpenAI API key not configured" });
  });

  it("returns 500 when resume execution throws", async () => {
    mockVerifyToken.mockResolvedValue("user-1");
    mockLoadJob.mockResolvedValue({ status: "resuming", command: "create SWOT" });
    mockExecuteAICommand.mockRejectedValue(new Error("boom"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const req: any = {
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: { boardId: "board-1", commandId: "cmd-1" },
    };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "boom" });
    consoleSpy.mockRestore();
  });

  it("resumes execution using stored command and same commandId", async () => {
    mockVerifyToken.mockResolvedValue("user-1");
    mockLoadJob.mockResolvedValue({
      status: "resuming",
      command: "create SWOT",
    });
    mockExecuteAICommand.mockResolvedValue({
      success: true,
      message: "done",
      objectsCreated: ["1"],
      objectsUpdated: [],
      objectsDeleted: [],
      runId: "cmd-1",
    });

    const req: any = {
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: {
        boardId: "board-1",
        commandId: "cmd-1",
        viewport: { minX: 1, minY: 2, maxX: 3, maxY: 4, centerX: 2, centerY: 3, scale: 1 },
        selectedIds: ["a"],
      },
    };
    const res = createRes();

    await handler(req, res);

    expect(mockExecuteAICommand).toHaveBeenCalledWith(
      "create SWOT",
      "board-1",
      "user-1",
      req.body.viewport,
      ["a"],
      "test-key",
      "cmd-1"
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
