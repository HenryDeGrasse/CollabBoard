/**
 * AICommandInput component tests.
 *
 * Covers:
 * 1. "Undo last AI change" only appears after a completed turn with tool actions.
 * 2. Clicking "Undo last AI change" calls onUndoSnapshot with the snapshot that
 *    was captured BEFORE the AI command ran (not the post-run board state).
 * 3. captureSnapshot is called once at the start of each AI command.
 * 4. Only the LAST completed entry shows the undo button.
 * 5. Prefill event opens the panel and sets the input value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { AICommandInput } from "../../components/sidebar/AICommandInput";

// Test fixture constants
const TEST_ACCESS_TOKEN = "tok-123";

// ── Auth mock ─────────────────────────────────────────────────────────────────
vi.mock("../../components/auth/AuthProvider", () => ({
  useAuth: () => ({ session: { access_token: TEST_ACCESS_TOKEN } }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
type SseEvent = { type: string; content: string };

/** Build a minimal Response whose body streams the given SSE events. */
function makeSseResponse(events: SseEvent[]): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/** Render the component without opening the panel. */
function renderAI(props: Partial<Parameters<typeof AICommandInput>[0]> = {}) {
  return render(
    <AICommandInput
      boardId="board-1"
      viewport={{ x: 0, y: 0, scale: 1 }}
      {...props}
    />
  );
}

/** Open the AI panel by clicking its trigger button. */
async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /ai assistant/i }));
}

describe("AICommandInput — undo last AI change", () => {
  const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
  // Queue of SSE responses to serve in order for /api/ai calls.
  // Health pings (/api/health) are intercepted separately so they don't
  // accidentally consume a slot meant for the AI endpoint.
  const sseQueue: Response[] = [];

  beforeEach(() => {
    sseQueue.length = 0;
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: RequestInfo | URL) => {
      if (String(url).includes("/api/health")) {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      const next = sseQueue.shift();
      return next
        ? Promise.resolve(next)
        : Promise.reject(new Error(`Unexpected fetch call: ${url}`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Undo button visibility
  // ─────────────────────────────────────────────────────────────────────────

  it("shows 'Undo last AI change' after a completed turn with tool actions", async () => {
    const user = userEvent.setup();

    sseQueue.push(
      makeSseResponse([
        { type: "tool_start", content: "create_objects" },
        { type: "text",       content: "Done!" },
        { type: "done",       content: "" },
      ])
    );

    renderAI({ onUndoSnapshot: vi.fn() });
    await openPanel(user);

    await user.type(screen.getByPlaceholderText(/ask ai/i), "create 3 stickies");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /undo last ai change/i })).toBeInTheDocument();
    });
  });

  it("does NOT show undo button for a turn with no tool actions", async () => {
    const user = userEvent.setup();

    sseQueue.push(
      makeSseResponse([
        { type: "text", content: "Here is some info." },
        { type: "done", content: "" },
      ])
    );

    renderAI({ onUndoSnapshot: vi.fn() });
    await openPanel(user);

    await user.type(screen.getByPlaceholderText(/ask ai/i), "what's on the board?");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.queryByText(/working…/i)).not.toBeInTheDocument()
    );

    expect(screen.queryByRole("button", { name: /undo last ai change/i })).not.toBeInTheDocument();
  });

  it("does NOT show undo button when onUndoSnapshot prop is absent", async () => {
    const user = userEvent.setup();

    sseQueue.push(
      makeSseResponse([
        { type: "tool_start", content: "create_objects" },
        { type: "done",       content: "" },
      ])
    );

    // No onUndoSnapshot prop provided
    renderAI();
    await openPanel(user);

    await user.type(screen.getByPlaceholderText(/ask ai/i), "add stickies");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.queryByText(/working…/i)).not.toBeInTheDocument()
    );

    expect(screen.queryByRole("button", { name: /undo last ai change/i })).not.toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Snapshot is captured BEFORE the AI call
  // ─────────────────────────────────────────────────────────────────────────

  it("calls captureSnapshot exactly once before sending the command", async () => {
    const user = userEvent.setup();
    const captureSnapshot = vi.fn(() => ({ objects: {}, connectors: {} }));

    sseQueue.push(
      makeSseResponse([{ type: "done", content: "" }])
    );

    renderAI({ captureSnapshot, onUndoSnapshot: vi.fn() });
    await openPanel(user);

    await user.type(screen.getByPlaceholderText(/ask ai/i), "hello");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.queryByText(/working…/i)).not.toBeInTheDocument()
    );

    expect(captureSnapshot).toHaveBeenCalledOnce();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Undo calls onUndoSnapshot with pre-command snapshot
  // ─────────────────────────────────────────────────────────────────────────

  it("clicking 'Undo last AI change' calls onUndoSnapshot with the pre-command snapshot", async () => {
    const user = userEvent.setup();

    const preSnapshot = {
      objects:    { "obj-before": { id: "obj-before" } as any },
      connectors: {},
    };
    const captureSnapshot = vi.fn(() => preSnapshot);
    const onUndoSnapshot  = vi.fn();

    sseQueue.push(
      makeSseResponse([
        { type: "tool_start", content: "create_objects" },
        { type: "text",       content: "Created!" },
        { type: "done",       content: "" },
      ])
    );

    renderAI({ captureSnapshot, onUndoSnapshot });
    await openPanel(user);

    await user.type(screen.getByPlaceholderText(/ask ai/i), "add a circle");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /undo last ai change/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /undo last ai change/i }));

    expect(onUndoSnapshot).toHaveBeenCalledOnce();
    expect(onUndoSnapshot).toHaveBeenCalledWith(preSnapshot);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Only the last entry shows the undo button
  // ─────────────────────────────────────────────────────────────────────────

  it("only shows one undo button even after multiple completed turns", async () => {
    const user = userEvent.setup();
    const onUndoSnapshot = vi.fn();

    // First command
    sseQueue.push(
      makeSseResponse([
        { type: "tool_start", content: "create_objects" },
        { type: "done",       content: "" },
      ])
    );
    // Second command
    sseQueue.push(
      makeSseResponse([
        { type: "tool_start", content: "update_objects" },
        { type: "done",       content: "" },
      ])
    );

    renderAI({ captureSnapshot: () => ({ objects: {}, connectors: {} }), onUndoSnapshot });
    await openPanel(user);

    // First turn
    await user.type(screen.getByPlaceholderText(/ask ai/i), "first");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => screen.getByRole("button", { name: /undo last ai change/i }));

    // Second turn
    await user.type(screen.getByPlaceholderText(/ask ai/i), "second");
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() =>
      expect(screen.queryByText(/working…/i)).not.toBeInTheDocument()
    );

    // Only one undo button for the latest entry
    expect(screen.getAllByRole("button", { name: /undo last ai change/i })).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Prefill event
  // ─────────────────────────────────────────────────────────────────────────

  it("prefill event opens the closed panel and sets the input text", async () => {
    render(
      <AICommandInput
        boardId="board-1"
        viewport={{ x: 0, y: 0, scale: 1 }}
      />
    );

    // Panel is closed initially — input not mounted
    expect(screen.queryByPlaceholderText(/ask ai/i)).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("collabboard:ai-prefill", { detail: { command: "Create a SWOT" } })
      );
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/ask ai/i)).toBeInTheDocument();
      expect(screen.getByDisplayValue("Create a SWOT")).toBeInTheDocument();
    });
  });
});
