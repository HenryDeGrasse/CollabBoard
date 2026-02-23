/**
 * Shared constants for CollabBoard.
 *
 * Centralises "magic numbers" so they are discoverable, documented, and
 * easy to tune without grepping across multiple files.
 */

// ─── Drag System ───────────────────────────────────────────────

/** Minimum interval (ms) between presence/drag broadcasts to Supabase. */
export const DRAG_BROADCAST_INTERVAL_MS = 50;

/** When the total number of dragged objects (primary + group + frame children)
 *  reaches this threshold, the drag system switches to bulk mode: direct Konva
 *  node manipulation, no React state updates during drag. */
export const BULK_DRAG_THRESHOLD = 20;

/** Delay (ms) after a drag ends before clearing live drag positions from state.
 *  Gives connectors/frame overlays one more render with the final positions. */
export const DRAG_CLEAR_DELAY_MS = 120;

// ─── Presence / Cursors ────────────────────────────────────────

/** Target interval (ms) for cursor position broadcasts via Supabase Realtime. */
export const CURSOR_BROADCAST_INTERVAL_MS = 30;

/** Target interval (ms) for draft-text broadcasts during text editing. */
export const DRAFT_TEXT_BROADCAST_INTERVAL_MS = 250;

/** Heartbeat interval (ms): re-broadcasts current drag positions while the user
 *  holds still to prevent collaborators from seeing the object snap back. */
export const DRAG_HEARTBEAT_INTERVAL_MS = 600;

/** Delay (ms) after a remote drag_end before clearing the drag preview.
 *  Gives Supabase Realtime time to deliver the final DB write. */
export const REMOTE_DRAG_CLEAR_DELAY_MS = 300;

/** Timeout (ms) after which a stale remote drag preview is garbage-collected.
 *  Only fires for genuine disconnects / crashes (heartbeat keeps active drags alive). */
export const STALE_DRAG_TIMEOUT_MS = 6000;

/** Cleanup interval (ms) for the stale drag preview GC timer. */
export const STALE_DRAG_GC_INTERVAL_MS = 1000;

// ─── Board Data (useBoard) ─────────────────────────────────────

/** Flush interval (ms) for coalesced object update writes.
 *  Batches rapid drag/resize updates into a single DB write. */
export const OBJECT_UPDATE_FLUSH_MS = 40;

// ─── Undo / Redo ───────────────────────────────────────────────

/** Maximum number of undo steps kept in the undo stack. */
export const MAX_UNDO_DEPTH = 30;

// ─── Canvas / Frames ───────────────────────────────────────────

/** Inner padding (px) between a frame's edge and its contained objects. */
export const FRAME_CONTENT_PADDING = 6;

/** Viewport culling margin (canvas px) added outside the visible bounds to
 *  avoid pop-in during fast panning. */
export const VIEWPORT_CULL_MARGIN = 200;

/** Hysteresis threshold (screen px) — the viewport must move at least this far
 *  before visible bounds are recomputed, preventing O(N) filtering on every pixel. */
export const VIEWPORT_HYSTERESIS_PX = 100;

/** Hysteresis threshold (scale delta) — the zoom level must change at least this
 *  much before visible bounds are recomputed. */
export const VIEWPORT_HYSTERESIS_SCALE = 0.02;

// ─── Selection ─────────────────────────────────────────────────

/** Minimum drag distance (px) for a selection rectangle to be considered meaningful. */
export const SELECTION_RECT_MIN_SIZE = 5;

// ─── Frame Containment ─────────────────────────────────────────

/** Pop-out threshold when the object was previously inside the frame (hysteresis). */
export const FRAME_POP_OUT_THRESHOLD_INSIDE = 0.45;

/** Pop-out threshold when the object was previously outside the frame (hysteresis). */
export const FRAME_POP_OUT_THRESHOLD_OUTSIDE = 0.55;
