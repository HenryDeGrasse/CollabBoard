# AGENTS.md — CollabBoard Architecture Guide

This document is for AI coding agents and new contributors. It describes the architecture, conventions, and common pitfalls so you can make changes confidently without breaking things.

---

## High-Level Architecture

```
BoardPage (page coordinator)
  ├── useBoard            — CRUD + Supabase Realtime sync
  ├── usePresence         — cursor broadcasting + user list
  ├── useCanvas           — zoom, pan, viewport state
  ├── useSelection        — selected object IDs + multi-select
  ├── useUndoRedo         — undo/redo stack (own-actions only, depth 30)
  ├── useKeyboardShortcuts — tool switching, copy/paste/duplicate, text size
  ├── useThumbnailCapture — JPEG thumbnail on navigate-away
  ├── useTextStyleHandlers — text size/color/align derived state + handlers
  └── Board (canvas orchestrator)
        ├── useObjectPartitioning — splits objects into frames vs top-level
        ├── useViewportCulling    — culls off-screen objects
        ├── useLivePositions      — merges local drag positions with DB state
        ├── useDragSystem         — drag orchestration (single, group, bulk)
        ├── useConnectorDraw      — arrow/connector drawing tool
        ├── useDrawingTools       — shape/sticky/line creation tools
        ├── useFrameInteraction   — frame header drag + resize push
        └── useInputHandling      — stage click/tap/context menu
```

## Rendering Layer Order

Frames render in a specific z-order to support clipping and overlays:

```
Layer (single Konva layer)
  ├── GridBackground
  ├── For each frame (sorted by zIndex):
  │     ├── Frame              — background, title bar, body hitbox (BEHIND children)
  │     ├── Group (clipFunc)   — clips to frame content area
  │     │     ├── contained objects (StickyNote, Shape, etc.)
  │     │     └── contained connectors
  │     └── FrameOverlay       — border, title, resize handles (ON TOP of children)
  ├── Top-level objects (not in any frame)
  ├── Top-level connectors
  ├── DrawingPreviews (in-progress shapes)
  ├── SelectionRect
  ├── RemoteCursorsLayer
  └── ToolHints
```

**Why two components per frame?** `Frame` renders behind children so the background is visible. `FrameOverlay` renders on top so the title bar, resize handles, and border overlay clipped children. The clip group sits between them.

## Frame Drag System (Unified)

**IMPORTANT:** Frames use ONLY manual mouse-tracking for dragging, NOT Konva's native `draggable`. The `Frame` component has `draggable={false}` — do NOT re-enable it.

The sole drag system for frames is `useFrameInteraction`:
- Drag starts via `onMouseDown` on the FrameOverlay header hitbox
- Manual mouse tracking via `window.addEventListener("mousemove"/"mouseup")`
- Supports group drag (moves all selected objects when dragging from a frame header)
- Updates both React state and direct Konva node positions for smooth 60fps rendering
- Commits final positions on mouseup with proper undo batching

**Why not Konva drag?** Previously both systems existed and could fire simultaneously on the same click, causing duplicate broadcasts and race conditions. The manual system is the correct one because it handles group drag, child containment updates, and frame-specific resize behavior.

## Drag System Details

### useDragSystem
Handles dragging for non-frame objects (sticky notes, shapes, etc.):

- **Single drag**: One object, standard Konva `onDragMove`
- **Group drag**: Multiple selected objects — primary object dragged by Konva, others moved by offset via `groupDragOffsetsRef`
- **Bulk drag** (≥20 objects): Bypasses React state entirely. Moves Konva nodes directly via `stage.findOne('#node-${id}')` for performance. Only broadcasts frame positions via `scheduleDragStateUpdate`.
- **`scheduleDragStateUpdate`**: rAF-batched function that updates drag positions for frame position broadcasting to collaborators
- **`clearDragPositionsSoon`**: 120ms delayed cleanup that zeroes out drag positions after drag ends

### useFrameInteraction
Handles frame-specific interactions:
- Header drag (with group support via `groupOffsets`)
- Frame resize with child push (children are clamped to frame bounds during resize)
- Frame resize preview for smooth visual feedback

## Optimistic Update Pipeline

`createObject` returns a **temporary UUID** immediately for instant UI feedback. The real ID arrives asynchronously from Supabase:

```
createObject() → tempId (UUID) → UI renders immediately
                   ↓
              Supabase INSERT → realId
                   ↓
              objects[tempId] deleted, objects[realId] added
                   ↓
              IdRemapCallback fires → selection updated
```

The `IdRemapCallback` system (in `useBoard`) notifies consumers when a temp ID becomes a real ID, so selection state stays consistent.

## Konva Node ID Convention

All rendered objects use `id={`node-${object.id}`}` on their root Konva Group. This allows direct node lookup via `stage.findOne('#node-${id}')` for:
- Bulk drag mode (direct position manipulation)
- Group drag offset application
- Frame interaction visual updates

## Presence & Cursor System

- **Cursor broadcast**: `usePresence` broadcasts cursor position via Supabase Realtime channel
- **Cursor interpolation**: `useCursorInterpolation` uses adaptive linear lerp with measured broadcast interval clamped [8ms, 80ms]
- **Drag heartbeat**: Re-broadcasts every 600ms while dragging to prevent collaborator jump-back when the user holds still
- **Remote drag positions**: Shared via `remoteDragPositions` record — shows collaborators' in-progress drags

## Hook Extraction Pattern

BoardPage delegates responsibilities to focused hooks:

| Hook | Responsibility | Lines |
|---|---|---|
| `useKeyboardShortcuts` | Tool keys, undo/redo, copy/paste/duplicate, text size shortcuts | ~150 |
| `useThumbnailCapture` | JPEG capture on unmount, localStorage persistence | ~30 |
| `useTextStyleHandlers` | Text size/color/align derived state + mutation handlers | ~60 |

Each hook receives refs or stable callbacks, never raw state that would cause re-subscription loops.

## Common Pitfalls

1. **Don't re-enable `draggable` on Frame** — This reintroduces the dual drag system race condition. All frame dragging goes through `useFrameInteraction`.

2. **Don't bypass `scheduleDragStateUpdate`** — Frame positions during drag must go through this rAF-batched function to avoid flooding the network and ensure collaborators see smooth movement.

3. **Ref stale closures** — Many hooks use refs (`objectsRef`, `connectorsRef`, `selectionRef`) instead of state in event handlers. This avoids stale closure issues in long-lived callbacks. Always read `.current` at call time, not at closure creation time.

4. **Bulk drag threshold** — When ≥20 objects are being dragged, the system switches to direct Konva node manipulation. If you add new drag behavior, make sure it works in both normal and bulk modes.

5. **Frame clipping** — Objects inside frames are rendered within a `clipFunc` Group. If you add new renderable elements inside frames, they must go inside this clipped group or they'll render outside the frame bounds.

6. **Temp IDs** — `createObject` returns a temporary UUID. Don't assume the ID in `objects` will match what `createObject` returned after the next render cycle. Use `IdRemapCallback` if you need to track the mapping.

7. **Text size precedence** — If `object.textSize` is a number, it's a user override and must be respected. If `undefined`, auto-fit calculates the size from object dimensions. Don't set `textSize` unless the user explicitly changes it.

## Testing

```bash
npm test              # 509 Vitest tests
npm run test:watch    # Watch mode
npm run test:e2e      # Playwright E2E
```

All 509 tests must pass before committing (enforced by Husky pre-commit hook).

## File Index

| File | Purpose |
|---|---|
| `src/pages/BoardPage.tsx` | Page coordinator — auth, hooks, toolbar, sidebar panels |
| `src/components/canvas/Board.tsx` | Canvas orchestrator — rendering, partitioning, event delegation |
| `src/components/canvas/Frame.tsx` | Frame background + FrameOverlay (title, resize, border) |
| `src/components/canvas/StickyNote.tsx` | Sticky note rendering |
| `src/components/canvas/Shape.tsx` | Rectangle, circle, line rendering |
| `src/components/canvas/Connector.tsx` | Arrow/connector rendering |
| `src/hooks/useBoard.ts` | CRUD operations + Supabase Realtime sync |
| `src/hooks/useDragSystem.ts` | Drag orchestration (single/group/bulk) |
| `src/hooks/useFrameInteraction.ts` | Frame header drag + resize push |
| `src/hooks/useKeyboardShortcuts.ts` | Keyboard shortcut handler |
| `src/hooks/useTextStyleHandlers.ts` | Text style derived state + handlers |
| `src/hooks/useThumbnailCapture.ts` | Thumbnail capture on navigate-away |
| `src/utils/frame-containment.ts` | Frame child containment logic |
| `src/utils/text-style.ts` | Text size resolution, auto-contrast, frame title sizing |
| `api/_lib/ai/` | AI agent backend (router, digest, planner, tools, versioning) |
