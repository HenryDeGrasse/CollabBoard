import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface PresenceState {
  displayName: string;
  cursorColor: string;
  cursor: { x: number; y: number } | null;
  editingObjectId: string | null;
  draftText?: string;
}

const CURSOR_COLORS = [
  "#EF4444", "#3B82F6", "#22C55E", "#F97316",
  "#A855F7", "#EC4899", "#14B8A6", "#F59E0B",
];

let colorIndex = 0;

export function getNextCursorColor(): string {
  return CURSOR_COLORS[colorIndex++ % CURSOR_COLORS.length];
}

/**
 * Create a Realtime Presence channel for a board.
 * Presence is used for online list + edit locks.
 * Cursor movement is sent via broadcast for lower latency.
 */
export function createPresenceChannel(
  boardId: string,
  userId: string,
  displayName: string,
  cursorColor: string,
  onSync: (state: Record<string, PresenceState[]>) => void,
  onCursor?: (userId: string, x: number, y: number) => void,
  onObjectDrag?: (
    userId: string,
    objectId: string,
    position: { x: number; y: number },
    parentFrameId?: string | null,
    ended?: boolean,
    width?: number,
    height?: number
  ) => void
) {
  // Presence + broadcast MUST use a shared topic across collaborators.
  // (Do not append a random suffix here, or peers won't see each other.)
  const channel = supabase.channel(`board-presence:${boardId}`, {
    config: { presence: { key: userId } },
  });

  // Track WebSocket readiness — only send broadcasts when connected.
  // Prevents costly REST fallback that tanks FPS.
  let channelReady = false;

  // Hold the most recent cursor position received before the channel was ready.
  // Flushed immediately on SUBSCRIBED so collaborators see the cursor without
  // waiting for the next mousemove (which may never come if the user is idle).
  let pendingCursor: { x: number; y: number } | null = null;

  const localPresence: PresenceState = {
    displayName,
    cursorColor,
    cursor: null,
    editingObjectId: null,
  };

  const trackPresence = async () => {
    try {
      await channel.track(localPresence);
    } catch {
      // Best effort; channel may be reconnecting.
    }
  };

  // Fire-and-forget broadcast — only when WebSocket is ready.
  // Cursors and drag previews are ephemeral; safe to drop when disconnected.
  const broadcastIfReady = (event: string, payload: Record<string, unknown>) => {
    if (!channelReady) return;
    channel.send({ type: "broadcast", event, payload }).catch(() => {});
  };

  // Listen for presence sync
  channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState<PresenceState>();
    onSync(state);
  });

  // Low-latency cursor updates via broadcast
  channel.on("broadcast", { event: "cursor" }, (message) => {
    const payload = message.payload as { userId?: string; x?: number; y?: number };
    if (!payload?.userId || payload.userId === userId) return;
    if (typeof payload.x !== "number" || typeof payload.y !== "number") return;
    onCursor?.(payload.userId, payload.x, payload.y);
  });

  // Low-latency object drag previews for collaborators
  channel.on("broadcast", { event: "object_drag" }, (message) => {
    const payload = message.payload as {
      userId?: string;
      objectId?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      parentFrameId?: string | null;
    };
    if (!payload?.userId || payload.userId === userId) return;
    if (!payload.objectId || typeof payload.x !== "number" || typeof payload.y !== "number") return;
    onObjectDrag?.(
      payload.userId,
      payload.objectId,
      { x: payload.x, y: payload.y },
      payload.parentFrameId,
      false,
      typeof payload.width === "number" ? payload.width : undefined,
      typeof payload.height === "number" ? payload.height : undefined
    );
  });

  channel.on("broadcast", { event: "object_drag_end" }, (message) => {
    const payload = message.payload as { userId?: string; objectId?: string };
    if (!payload?.userId || payload.userId === userId) return;
    if (!payload.objectId) return;
    onObjectDrag?.(payload.userId, payload.objectId, { x: 0, y: 0 }, undefined, true);
  });

  // Subscribe and track initial presence when connected
  channel.subscribe(async (status, err) => {
    channelReady = status === "SUBSCRIBED";
    if (status === "SUBSCRIBED") {
      await trackPresence();
      // Flush any cursor position queued before the channel was ready so
      // collaborators see this user's cursor without waiting for the next move.
      if (pendingCursor) {
        channel
          .send({ type: "broadcast", event: "cursor", payload: { userId, ...pendingCursor } })
          .catch(() => {});
        pendingCursor = null;
      }
    }
  });

  return {
    channel,

    updateCursor: (x: number, y: number) => {
      localPresence.cursor = { x, y };
      if (!channelReady) {
        // Queue the latest position — flushed when the channel opens.
        pendingCursor = { x, y };
        return;
      }
      pendingCursor = null;
      channel.send({ type: "broadcast", event: "cursor", payload: { userId, x, y } }).catch(() => {});
    },

    setEditingObject: (objectId: string | null) => {
      localPresence.editingObjectId = objectId;
      if (objectId === null) {
        localPresence.draftText = undefined;
      }
      trackPresence();
    },

    setDraftText: (objectId: string, text: string) => {
      localPresence.editingObjectId = objectId;
      localPresence.draftText = text;
      trackPresence();
    },

    updateObjectDrag: (
      objectId: string,
      x: number,
      y: number,
      parentFrameId?: string | null,
      width?: number,
      height?: number
    ) => {
      broadcastIfReady("object_drag", { userId, objectId, x, y, parentFrameId, width, height });
    },

    endObjectDrag: (objectId: string) => {
      broadcastIfReady("object_drag_end", { userId, objectId });
    },

    unsubscribe: () => {
      channel.untrack();
      supabase.removeChannel(channel);
    },
  };
}

/**
 * Create Realtime channels for board data changes (objects + connectors).
 *
 * Uses **separate** channels per table to prevent Supabase Realtime from
 * cross-firing events when multiple `postgres_changes` handlers share a
 * single channel (known issue with the JS client multiplexing).
 */
export function createBoardRealtimeChannels(
  boardId: string,
  onObjectChange: (eventType: "INSERT" | "UPDATE" | "DELETE", row: any) => void,
  onConnectorChange: (eventType: "INSERT" | "UPDATE" | "DELETE", row: any) => void
): RealtimeChannel[] {
  // Append a random suffix so each effect invocation gets a unique channel
  // topic. React Strict Mode double-invokes effects, sending phx_join →
  // phx_leave → phx_join in rapid succession. If the server processes the
  // leave *after* the second join on the same topic, it kills the active
  // subscription (channel reports SUBSCRIBED but WAL events stop flowing).
  const suffix = Math.random().toString(36).slice(2, 8);
  const objectsChannel = supabase.channel(`board-objects:${boardId}:${suffix}`);
  const connectorsChannel = supabase.channel(`board-connectors:${boardId}:${suffix}`);

  objectsChannel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "objects", filter: `board_id=eq.${boardId}` },
      (payload) => {
        onObjectChange(
          payload.eventType as "INSERT" | "UPDATE" | "DELETE",
          payload.eventType === "DELETE" ? payload.old : payload.new
        );
      }
    )
    .subscribe((status, err) => {
    });

  connectorsChannel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "connectors", filter: `board_id=eq.${boardId}` },
      (payload) => {
        onConnectorChange(
          payload.eventType as "INSERT" | "UPDATE" | "DELETE",
          payload.eventType === "DELETE" ? payload.old : payload.new
        );
      }
    )
    .subscribe((status, err) => {
    });

  return [objectsChannel, connectorsChannel];
}
