/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import handler from "../../../api/health";

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

describe("GET /api/health", () => {
  it("returns non-secret configuration diagnostics", async () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secret";
    process.env.OPENAI_API_KEY = "openai";

    const req: any = { method: "GET" };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      supabaseUrl: "http://127.0.0.1:54321",
      hasServiceKey: true,
      hasOpenAI: true,
      langsmith: {
        tracing: expect.any(Boolean),
        project: expect.any(String),
        hasKey: expect.any(Boolean),
      },
      aiRouteLatency: expect.objectContaining({
        windowMinutes: expect.any(Number),
        sampleCount: expect.any(Number),
        bySource: expect.any(Object),
        byIntent: expect.any(Object),
      }),
      nodeEnv: expect.any(String),
    });
  });
});
