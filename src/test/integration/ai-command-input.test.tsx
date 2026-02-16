import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AICommandInput } from "../../components/sidebar/AICommandInput";

describe("AICommandInput integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens panel and shows placeholder helper text", async () => {
    const user = userEvent.setup();
    render(
      <AICommandInput
        aiAgent={{
          sendCommand: vi.fn(),
          isProcessing: false,
          lastResponse: null,
          error: null,
        }}
      />
    );

    await user.click(screen.getByTitle(/ai assistant/i));
    expect(screen.getByText(/ai-powered board commands are coming soon/i)).toBeInTheDocument();
  });

  it("shows coming soon message on submit and clears input", async () => {
    const user = userEvent.setup();
    render(
      <AICommandInput
        aiAgent={{
          sendCommand: vi.fn(),
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

    expect(screen.getByText(/ai assistant coming soon/i)).toBeInTheDocument();
    expect(input).toHaveValue("");
  });
});
