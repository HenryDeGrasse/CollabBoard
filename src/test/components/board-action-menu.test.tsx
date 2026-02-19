/**
 * Board action menu (the ⋯ button on board cards/rows).
 *
 * Invariants tested:
 * 1. Portal — dropdown renders as child of document.body, never inside the card.
 * 2. All expected actions are present for owners vs. editors.
 * 3. Each action fires the right callback and closes the menu.
 * 4. Outside click closes the menu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { BoardActionMenuTest } from "../../pages/HomePage";

// ── Helper ────────────────────────────────────────────────────────────────────

function renderInCard(props: {
  title?: string;
  isOwner?: boolean;
  onOpen?: () => void;
  onDelete?: () => void;
  onCopyInvite?: () => void;
  onCopyBoardId?: () => void;
}) {
  const {
    title = "My Board",
    isOwner = true,
    onOpen = vi.fn(),
    onDelete = vi.fn(),
    onCopyInvite = vi.fn(),
    onCopyBoardId = vi.fn(),
  } = props;

  return render(
    // Simulate card with overflow:hidden — would clip a non-portal dropdown.
    <div data-testid="overflow-card" style={{ overflow: "hidden", width: 200, height: 80 }}>
      <BoardActionMenuTest
        title={title}
        isOwner={isOwner}
        onOpen={onOpen}
        onDelete={onDelete}
        onCopyInvite={onCopyInvite}
        onCopyBoardId={onCopyBoardId}
      />
    </div>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BoardActionMenu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  // ── Trigger ──────────────────────────────────────────────────────────────

  it("renders a trigger button with an accessible label", () => {
    renderInCard({ title: "Test Board" });
    expect(screen.getByRole("button", { name: /board actions test board/i })).toBeInTheDocument();
  });

  it("is closed by default — no menu items visible", () => {
    renderInCard({});
    expect(screen.queryByTestId("board-action-dropdown")).not.toBeInTheDocument();
  });

  it("opens the dropdown on trigger click", async () => {
    const user = userEvent.setup();
    renderInCard({ title: "Test Board" });
    await user.click(screen.getByRole("button", { name: /board actions test board/i }));
    expect(screen.getByRole("button", { name: /^open$/i })).toBeInTheDocument();
  });

  // ── Portal contract ───────────────────────────────────────────────────────

  it("renders the open dropdown at document.body level (portal), not inside the card", async () => {
    const user = userEvent.setup();
    renderInCard({ title: "Portal Board" });
    await user.click(screen.getByRole("button", { name: /board actions portal board/i }));

    const openBtn = screen.getByRole("button", { name: /^open$/i });
    const card = document.querySelector("[data-testid='overflow-card']")!;

    expect(card).not.toContainElement(openBtn);
    expect(document.body).toContainElement(openBtn);
  });

  // ── Owner actions ─────────────────────────────────────────────────────────

  it("owner menu shows: Open, Copy invite link, Copy board ID, Delete board", async () => {
    const user = userEvent.setup();
    renderInCard({ isOwner: true, title: "Owner Board" });
    await user.click(screen.getByRole("button", { name: /board actions owner board/i }));

    expect(screen.getByRole("button", { name: /^open$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy invite link/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy board id/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete board owner board/i })).toBeInTheDocument();
  });

  it("clicking 'Copy invite link' calls onCopyInvite and closes the menu", async () => {
    const user = userEvent.setup();
    const onCopyInvite = vi.fn();
    renderInCard({ isOwner: true, title: "Invite Board", onCopyInvite });

    await user.click(screen.getByRole("button", { name: /board actions invite board/i }));
    await user.click(screen.getByRole("button", { name: /copy invite link/i }));

    expect(onCopyInvite).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("board-action-dropdown")).not.toBeInTheDocument();
  });

  it("clicking 'Copy board ID' calls onCopyBoardId and closes the menu", async () => {
    const user = userEvent.setup();
    const onCopyBoardId = vi.fn();
    renderInCard({ isOwner: true, title: "ID Board", onCopyBoardId });

    await user.click(screen.getByRole("button", { name: /board actions id board/i }));
    await user.click(screen.getByRole("button", { name: /copy board id/i }));

    expect(onCopyBoardId).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("board-action-dropdown")).not.toBeInTheDocument();
  });

  it("clicking 'Delete board' calls onDelete and closes the menu", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderInCard({ isOwner: true, title: "Delete Board", onDelete });

    await user.click(screen.getByRole("button", { name: /board actions delete board/i }));
    await user.click(screen.getByRole("button", { name: /delete board delete board/i }));

    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("board-action-dropdown")).not.toBeInTheDocument();
  });

  // ── Non-owner (editor) actions ────────────────────────────────────────────

  it("non-owner menu shows: Open, Copy board ID, Leave board — no invite link", async () => {
    const user = userEvent.setup();
    renderInCard({ isOwner: false, title: "Shared Board" });
    await user.click(screen.getByRole("button", { name: /board actions shared board/i }));

    expect(screen.getByRole("button", { name: /^open$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy board id/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /leave board shared board/i })).toBeInTheDocument();
    // Owners-only action must be absent
    expect(screen.queryByRole("button", { name: /copy invite link/i })).not.toBeInTheDocument();
  });

  it("clicking 'Leave board' calls onDelete and closes the menu", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderInCard({ isOwner: false, title: "Shared Board", onDelete });

    await user.click(screen.getByRole("button", { name: /board actions shared board/i }));
    await user.click(screen.getByRole("button", { name: /leave board shared board/i }));

    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("board-action-dropdown")).not.toBeInTheDocument();
  });

  // ── Common actions ────────────────────────────────────────────────────────

  it("clicking 'Open' calls onOpen and closes the menu", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderInCard({ title: "My Board", onOpen });

    await user.click(screen.getByRole("button", { name: /board actions my board/i }));
    await user.click(screen.getByRole("button", { name: /^open$/i }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("board-action-dropdown")).not.toBeInTheDocument();
  });

  it("closes the menu when clicking outside (window click)", async () => {
    const user = userEvent.setup();
    renderInCard({ title: "Closable" });

    await user.click(screen.getByRole("button", { name: /board actions closable/i }));
    expect(screen.getByTestId("board-action-dropdown")).toBeInTheDocument();

    act(() => { fireEvent.click(document.body); });

    expect(screen.queryByTestId("board-action-dropdown")).not.toBeInTheDocument();
  });
});
