import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AICommandInput } from "../../components/sidebar/AICommandInput";
import type { AICommandResponse } from "../../types/ai";

const mockResponse: AICommandResponse = {
  success: true,
  message: "Done! 1 object(s) created.",
  objectsCreated: ["obj1"],
  objectsUpdated: [],
  objectsDeleted: [],
  runId: "test-run",
};

describe("AICommandInput integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens panel and shows suggestion text", async () => {
    const user = userEvent.setup();
    render(
      <AICommandInput
        aiAgent={{
          sendCommand: vi.fn().mockResolvedValue(mockResponse),
          isProcessing: false,
          lastResponse: null,
          error: null,
        }}
      />
    );

    await user.click(screen.getByTitle(/ai assistant/i));
    expect(screen.getByText(/ai-powered board commands/i)).toBeInTheDocument();
  });

  it("submits command and shows response", async () => {
    const sendCommand = vi.fn().mockResolvedValue(mockResponse);
    const user = userEvent.setup();
    render(
      <AICommandInput
        aiAgent={{
          sendCommand,
          isProcessing: false,
          lastResponse: null,
          error: null,
        }}
      />
    );

    await user.click(screen.getByTitle(/ai assistant/i));
    const input = screen.getByPlaceholderText(/ask ai to create or arrange/i);
    await user.type(input, "Create a SWOT board");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(sendCommand).toHaveBeenCalledWith("Create a SWOT board");
    expect(input).toHaveValue("");
    // Response should appear in history
    expect(await screen.findByText(/Done! 1 object/i)).toBeInTheDocument();
  });
});
