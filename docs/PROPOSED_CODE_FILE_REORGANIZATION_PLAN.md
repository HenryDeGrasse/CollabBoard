# Proposed Code File Reorganization Plan

**Date:** 2026-02-22  
**Scope:** `src/` directory of the CollabBoard project  
**Status:** Implemented on branch `reorganize/round1` (Round 1 + Round 2 complete)

---

## Table of Contents

0. [Round 1 Scope Amendment (Supersedes Conflicts Below)](#0-round-1-scope-amendment-supersedes-conflicts-below)
1. [Executive Summary](#1-executive-summary)
2. [Current Structure Analysis](#2-current-structure-analysis)
3. [Problems With the Current Structure](#3-problems-with-the-current-structure)
4. [Proposed New Structure](#4-proposed-new-structure)
5. [Detailed Rationale for Each Change](#5-detailed-rationale-for-each-change)
6. [File Merge & Split Proposals](#6-file-merge--split-proposals)
7. [Full File Move Map](#7-full-file-move-map)
8. [Import Update Tracking](#8-import-update-tracking)
9. [Test File Reorganization](#9-test-file-reorganization)
10. [Migration Strategy & Risk Mitigation](#10-migration-strategy--risk-mitigation)
11. [Files NOT Moved (and Why)](#11-files-not-moved-and-why)
12. [AGENTS.md Updates Required](#12-agentsmd-updates-required)

---

## 0. Round 1 Scope Amendment (Supersedes Conflicts Below)

> **Implementation note (2026-02-22):** Round 1 and Round 2 are now complete on branch `reorganize/round1`, including utility merges and selected test relocations.

This amendment is the active execution scope for **Round 1**. If any detail in later sections conflicts with this amendment, this amendment wins.

### Round 1 (approved execution scope)

1. **Extract shared tool type**
   - Create `src/types/tool.ts` with `ToolType`.
   - Replace all imports of `ToolType` from `components/canvas/Board`.
   - Remove `ToolType` definition export from `Board.tsx`.

2. **Move hooks by domain (no behavior changes)**
   - Move canvas-only hooks to `src/hooks/canvas/`.
   - Move collaboration hooks to `src/hooks/presence/`.
   - Update all import paths in source and tests.

3. **Group (but do not merge) frame/text utility files**
   - Move to `src/utils/frame/` and `src/utils/text/` subfolders.
   - Keep file boundaries (`containment.ts`, `create.ts`, `fit.ts`, `style.ts`, `overlay-layout.ts`) for low-risk diffs.

4. **No test-file relocations in Round 1**
   - Keep test files in current paths.
   - Only update import paths required by source moves.

5. **Zero behavior change guardrails**
   - Frame drag remains manual (`Frame` stays `draggable={false}`).
   - `useDragSystem` bulk-drag path (>=20 objects) remains intact.
   - `scheduleDragStateUpdate` pipeline unchanged.
   - 120ms drag cleanup (`clearDragPositionsSoon`) unchanged.
   - Presence heartbeat and cursor interpolation behavior unchanged.

### Round 2 (completed)

- Utility merges completed (`text/* -> text.ts`, `frame/* -> frame.ts`).
- `services/board.ts` split into `board-types.ts`, `board-crud.ts`, `board-access.ts`, while keeping a temporary re-export facade in `services/board.ts`.
- Test relocations completed for hook-domain tests (`hooks/canvas/*`, `hooks/presence/*`).

## 1. Executive Summary

The `src/` directory currently has **18 hooks in a flat `hooks/` folder**, **9 utility files in a flat `utils/` folder**, and components organized by UI location rather than by functional domain. A developer looking at the hooks folder sees `useBoard`, `useCanvas`, `useCursorInterpolation`, `useDragSystem`, `useFrameInteraction`, `useLivePositions`, `useObjectPartitioning`, `usePresence`, etc. — all at the same level with no indication of which ones are related.

This plan proposes grouping files by **functional domain** (drag, presence/collaboration, frame, text, canvas rendering) using at most **two levels** of nesting inside `src/`. The reorganization:

- Groups the 7 drag/interaction-related hooks together
- Groups the 3 presence/collaboration files together
- Groups the 4 frame-related utility + hook files together
- Groups the 4 text-related utility files together
- Consolidates 3 small text utility files into 1
- Keeps the overall nesting depth to ≤2 subdirectories from `src/`

No files are deleted or renamed in ways that change their public API surface. Every import path change is tracked in this document.

---

## 2. Current Structure Analysis

### 2.1 Current Directory Tree (source files only, excluding tests)

```
src/
├── App.tsx                          (132 lines — routing, auth wrapper)
├── main.tsx                         (10 lines — ReactDOM entry)
├── index.css                        (styles)
├── vite-env.d.ts                    (15 lines — Vite types)
│
├── types/
│   └── board.ts                     (45 lines — BoardObject, Connector, ObjectType)
│
├── services/
│   ├── supabase.ts                  (10 lines — Supabase client singleton)
│   ├── board.ts                     (673 lines — all board/object/connector CRUD + access control)
│   └── presence.ts                  (241 lines — Realtime channels for presence + data sync)
│
├── hooks/
│   ├── useBoard.ts                  (557 lines — CRUD + Realtime sync state)
│   ├── useBoardMembershipGuard.ts   (74 lines — kick user on membership removal)
│   ├── useCanvas.ts                 (246 lines — zoom, pan, viewport state)
│   ├── useConnectorDraw.ts          (191 lines — arrow/connector drawing tool)
│   ├── useCursorInterpolation.ts    (247 lines — remote cursor lerp)
│   ├── useDragSystem.ts             (838 lines — drag orchestration)
│   ├── useDrawingTools.ts           (221 lines — shape/sticky/frame creation)
│   ├── useFrameInteraction.ts       (351 lines — frame header drag + resize)
│   ├── useInputHandling.ts          (327 lines — space/pan, selection rect, keyboard)
│   ├── useKeyboardShortcuts.ts      (251 lines — tool switching, copy/paste)
│   ├── useLivePositions.ts          (445 lines — merge drag positions, pop-out)
│   ├── useObjectPartitioning.ts     (171 lines — split objects by frame/type)
│   ├── usePresence.ts               (367 lines — cursor broadcast, user list)
│   ├── useSelection.ts              (64 lines — selected object IDs)
│   ├── useTextStyleHandlers.ts      (111 lines — text size/color/align handlers)
│   ├── useThumbnailCapture.ts       (44 lines — JPEG thumbnail on navigate-away)
│   ├── useUndoRedo.ts               (161 lines — undo/redo stack)
│   └── useViewportCulling.ts        (167 lines — off-screen object culling)
│
├── utils/
│   ├── colors.ts                    (41 lines — color constants + getters)
│   ├── export.ts                    (92 lines — PNG/SVG/JSON export)
│   ├── frame-containment.ts         (293 lines — containment, snap, push logic)
│   ├── frame-create.ts              (56 lines — frame gesture computation)
│   ├── selection.ts                 (123 lines — rect intersection, line-rect tests)
│   ├── text-fit.ts                  (51 lines — auto-fit font size)
│   ├── text-overlay-layout.ts       (40 lines — vertical padding estimation)
│   ├── text-style.ts                (97 lines — text size resolution, contrast)
│   └── throttle.ts                  (62 lines — generic throttle utility)
│
├── pages/
│   ├── BoardPage.tsx                (732 lines — board page coordinator)
│   ├── HomePage.tsx                 (690 lines — dashboard)
│   └── InviteAcceptPage.tsx         (153 lines — invite accept flow)
│
└── components/
    ├── auth/
    │   ├── AuthProvider.tsx          (88 lines — auth context + provider)
    │   └── LoginPage.tsx            (236 lines — login UI)
    ├── board/
    │   └── BoardSettingsPanel.tsx    (468 lines — settings/share panel)
    ├── canvas/
    │   ├── Board.tsx                (1097 lines — canvas orchestrator)
    │   ├── BoardObjectRenderer.tsx  (133 lines — object type dispatch)
    │   ├── Connector.tsx            (227 lines — arrow/line rendering)
    │   ├── DrawingPreviews.tsx      (129 lines — in-progress shape previews)
    │   ├── Frame.tsx                (405 lines — Frame + FrameOverlay)
    │   ├── GridBackground.tsx       (57 lines — infinite grid)
    │   ├── LineTool.tsx             (183 lines — freehand line rendering)
    │   ├── RemoteCursor.tsx         (45 lines — single remote cursor)
    │   ├── RemoteCursorsLayer.tsx   (43 lines — cursor layer + interpolation)
    │   ├── ResizeHandles.tsx        (213 lines — resize handle circles)
    │   ├── RotationHandle.tsx       (122 lines — rotation handle)
    │   ├── SelectionRect.tsx        (27 lines — selection rectangle)
    │   ├── Shape.tsx                (269 lines — rectangle/circle rendering)
    │   ├── StickyNote.tsx           (191 lines — sticky note rendering)
    │   ├── TextOverlay.tsx          (176 lines — HTML text editing overlay)
    │   ├── ToolHints.tsx            (43 lines — tool mode hints)
    │   └── TopLevelConnectors.tsx   (94 lines — top-level connector rendering)
    ├── sidebar/
    │   ├── AICommandInput.tsx       (523 lines — AI command panel)
    │   ├── PresencePanel.tsx        (47 lines — online user list)
    │   └── TextStylePanel.tsx       (139 lines — text style controls)
    ├── toolbar/
    │   └── Toolbar.tsx              (321 lines — tool bar)
    └── ui/
        ├── ExportMenu.tsx           (83 lines — export dropdown)
        └── HelpPanel.tsx            (136 lines — help shortcuts panel)
```

### 2.2 Import Relationship Map

Key dependency clusters I identified:

**Drag Cluster** (7 files, tightly coupled):
- `useDragSystem.ts` → imports `frame-containment`, `useUndoRedo` types
- `useFrameInteraction.ts` → imports `frame-containment`, `useCanvas` types, `useUndoRedo` types
- `useLivePositions.ts` → imports `frame-containment`
- `useInputHandling.ts` → imports `useUndoRedo` types, `Board` ToolType
- `useObjectPartitioning.ts` → imports `text-style`, `frame-containment`
- `useViewportCulling.ts` → imports `useCanvas` types

**Presence/Collaboration Cluster** (3 files):
- `services/presence.ts` → standalone, imports `supabase`
- `hooks/usePresence.ts` → imports `services/presence`, `utils/throttle`
- `hooks/useCursorInterpolation.ts` → imports `usePresence` types only

**Frame Cluster** (4 files):
- `utils/frame-containment.ts` — pure functions, 293 lines
- `utils/frame-create.ts` — pure functions, 56 lines
- `components/canvas/Frame.tsx` — rendering, imports `text-style`, `ResizeHandles`

**Text Cluster** (4 files, all closely related):
- `utils/text-fit.ts` (51 lines) — `calculateFontSize`
- `utils/text-overlay-layout.ts` (40 lines) — `estimateVerticalPaddingTop`
- `utils/text-style.ts` (97 lines) — imports `text-fit`, provides style resolution
- `hooks/useTextStyleHandlers.ts` (111 lines) — imports `text-style`

---

## 3. Problems With the Current Structure

### 3.1 Flat hooks/ folder is overwhelming
18 hooks at the same level. A new developer sees `useDragSystem`, `useFrameInteraction`, `useLivePositions`, `useObjectPartitioning`, `useViewportCulling` and has no way to know they're all part of the canvas interaction pipeline without reading each file.

### 3.2 Related utils are scattered
`frame-containment.ts` and `frame-create.ts` are both frame-related pure functions but sit next to `throttle.ts` (a generic utility) and `colors.ts` (constants). There's no grouping signal.

### 3.3 Three tiny text util files that should be one
`text-fit.ts` (51 lines), `text-overlay-layout.ts` (40 lines), and `text-style.ts` (97 lines) are all about text measurement and styling. They're split into three files despite `text-style.ts` already importing `text-fit.ts`, and both are consumed by the same components. The split creates unnecessary import indirection.

### 3.4 services/board.ts is doing too much
At 673 lines, `services/board.ts` handles:
- Board CRUD (create, list, delete, update metadata)
- Access control (join, invites, access requests, members, visibility)
- Object CRUD (create, update, delete, restore, bulk operations)
- Connector CRUD (create, update, delete, restore)
- DB↔App type mapping functions

This file has distinct responsibility zones that would benefit from splitting.

### 3.5 No grouping of canvas-only hooks vs page-level hooks
`useBoard`, `usePresence`, `useSelection`, `useUndoRedo` are page-level hooks used by `BoardPage.tsx`. Meanwhile `useDragSystem`, `useFrameInteraction`, `useLivePositions`, `useObjectPartitioning`, `useViewportCulling`, `useConnectorDraw`, `useDrawingTools`, `useInputHandling` are all used exclusively by `Board.tsx` (the canvas component). This distinction is invisible in the current flat structure.

---

## 4. Proposed New Structure

```
src/
├── App.tsx
├── main.tsx
├── index.css
├── vite-env.d.ts
│
├── types/
│   └── board.ts                          (unchanged)
│
├── services/
│   ├── supabase.ts                       (unchanged)
│   ├── board-crud.ts                     (SPLIT from board.ts — board/object/connector CRUD)
│   ├── board-access.ts                   (SPLIT from board.ts — join, invites, members, visibility, access requests)
│   ├── board-types.ts                    (SPLIT from board.ts — DB↔App mappers, BoardMetadata, interfaces)
│   └── presence.ts                       (unchanged)
│
├── hooks/
│   ├── useBoard.ts                       (unchanged location)
│   ├── useBoardMembershipGuard.ts        (unchanged location)
│   ├── useCanvas.ts                      (unchanged location)
│   ├── useSelection.ts                   (unchanged location)
│   ├── useUndoRedo.ts                    (unchanged location)
│   ├── useKeyboardShortcuts.ts           (unchanged location)
│   ├── useThumbnailCapture.ts            (unchanged location)
│   ├── useTextStyleHandlers.ts           (unchanged location)
│   │
│   ├── canvas/                           (NEW folder — hooks used only by Board.tsx)
│   │   ├── useDragSystem.ts              (MOVED from hooks/)
│   │   ├── useFrameInteraction.ts        (MOVED from hooks/)
│   │   ├── useLivePositions.ts           (MOVED from hooks/)
│   │   ├── useObjectPartitioning.ts      (MOVED from hooks/)
│   │   ├── useViewportCulling.ts         (MOVED from hooks/)
│   │   ├── useConnectorDraw.ts           (MOVED from hooks/)
│   │   ├── useDrawingTools.ts            (MOVED from hooks/)
│   │   └── useInputHandling.ts           (MOVED from hooks/)
│   │
│   └── presence/                         (NEW folder — collaboration hooks)
│       ├── usePresence.ts                (MOVED from hooks/)
│       └── useCursorInterpolation.ts     (MOVED from hooks/)
│
├── utils/
│   ├── throttle.ts                       (unchanged — generic utility)
│   ├── colors.ts                         (unchanged — app-wide constants)
│   ├── selection.ts                      (unchanged — pure geometry functions)
│   ├── export.ts                         (unchanged — export utilities)
│   ├── text.ts                           (MERGED: text-fit.ts + text-overlay-layout.ts + text-style.ts)
│   └── frame.ts                          (MERGED: frame-containment.ts + frame-create.ts)
│
├── pages/
│   ├── BoardPage.tsx                     (unchanged)
│   ├── HomePage.tsx                      (unchanged)
│   └── InviteAcceptPage.tsx              (unchanged)
│
└── components/
    ├── auth/                             (unchanged)
    │   ├── AuthProvider.tsx
    │   └── LoginPage.tsx
    ├── board/                            (unchanged)
    │   └── BoardSettingsPanel.tsx
    ├── canvas/                           (unchanged — all canvas rendering components)
    │   ├── Board.tsx
    │   ├── BoardObjectRenderer.tsx
    │   ├── Connector.tsx
    │   ├── DrawingPreviews.tsx
    │   ├── Frame.tsx
    │   ├── GridBackground.tsx
    │   ├── LineTool.tsx
    │   ├── RemoteCursor.tsx
    │   ├── RemoteCursorsLayer.tsx
    │   ├── ResizeHandles.tsx
    │   ├── RotationHandle.tsx
    │   ├── SelectionRect.tsx
    │   ├── Shape.tsx
    │   ├── StickyNote.tsx
    │   ├── TextOverlay.tsx
    │   ├── ToolHints.tsx
    │   └── TopLevelConnectors.tsx
    ├── sidebar/                          (unchanged)
    │   ├── AICommandInput.tsx
    │   ├── PresencePanel.tsx
    │   └── TextStylePanel.tsx
    ├── toolbar/                          (unchanged)
    │   └── Toolbar.tsx
    └── ui/                               (unchanged)
        ├── ExportMenu.tsx
        └── HelpPanel.tsx
```

---

## 5. Detailed Rationale for Each Change

### 5.1 `hooks/canvas/` — Canvas-Only Hooks Subfolder

**What moves:** `useDragSystem`, `useFrameInteraction`, `useLivePositions`, `useObjectPartitioning`, `useViewportCulling`, `useConnectorDraw`, `useDrawingTools`, `useInputHandling`

**Why:** These 8 hooks are used **exclusively** by `components/canvas/Board.tsx`. They form the internal machinery of the canvas — drag orchestration, viewport culling, frame interaction, drawing tools, input handling. They are never imported by `BoardPage.tsx`, `HomePage.tsx`, or any sidebar/toolbar component directly.

Grouping them under `hooks/canvas/` immediately communicates:
- "These hooks are canvas internals — if you're working on the canvas, look here."
- "If you're working on BoardPage-level logic (auth, settings, toolbar), you don't need these."

The remaining hooks in `hooks/` root (`useBoard`, `useCanvas`, `useSelection`, `useUndoRedo`, `useKeyboardShortcuts`, `useThumbnailCapture`, `useTextStyleHandlers`, `useBoardMembershipGuard`) are all used by `BoardPage.tsx` or at the page level. This split mirrors the architecture described in AGENTS.md: `BoardPage` (page coordinator) vs `Board` (canvas orchestrator).

**Nesting depth:** `src/hooks/canvas/useDragSystem.ts` — only 2 levels, very manageable.

### 5.2 `hooks/presence/` — Collaboration Hooks Subfolder

**What moves:** `usePresence`, `useCursorInterpolation`

**Why:** These two hooks are the React-side of the collaboration/presence system. `usePresence` manages the Supabase Realtime channel for cursor broadcasting and the online user list. `useCursorInterpolation` smoothly interpolates remote cursor positions using rAF. They're tightly coupled (`useCursorInterpolation` imports types from `usePresence`) and together form the complete "collaboration awareness" feature.

Grouping them under `hooks/presence/` immediately signals "this is the collaboration layer" and separates them from canvas-internal hooks and page-level hooks.

### 5.3 `utils/text.ts` — Merge Three Text Utility Files

**What merges:** `text-fit.ts` (51 lines) + `text-overlay-layout.ts` (40 lines) + `text-style.ts` (97 lines) → `text.ts` (~188 lines)

**Why:**
- `text-style.ts` already imports `text-fit.ts` (the `calculateFontSize` function).
- `text-overlay-layout.ts` is only imported by `TextOverlay.tsx` and exports a single function (`estimateVerticalPaddingTop`).
- All three files are about the same thing: computing text sizing, layout, and styling for board objects.
- 188 lines combined is still a very manageable single file — well below the "too big" threshold.
- Having three separate files means three separate import paths to remember. One file means one import.
- Every consumer currently imports from 2+ of these files; after the merge, they import from one.

The merged file will retain all existing exports with the same names, so consumers just need their import paths updated.

### 5.4 `utils/frame.ts` — Merge Two Frame Utility Files

**What merges:** `frame-containment.ts` (293 lines) + `frame-create.ts` (56 lines) → `frame.ts` (~349 lines)

**Why:**
- Both files are pure functions related to frame geometry and behavior.
- `frame-create.ts` has only one exported function (`computeFrameFromGesture`) plus its types. It's too small to justify a separate file.
- `frame-containment.ts` contains all the spatial logic for frames (containment, snap, push-out, constrain children). Adding the frame creation gesture logic to this file makes it the single place to look for "how frames work geometrically."
- 349 lines is moderate for a utility file — not too big, and well-organized with distinct function groups.
- Consumers that currently import from both files (`useDrawingTools` imports `frame-create`, while `useDragSystem`, `useFrameInteraction`, `useLivePositions`, `useObjectPartitioning` import `frame-containment`) will now import from one path.

### 5.5 Split `services/board.ts` Into Three Files

**What splits:** `services/board.ts` (673 lines) → `board-types.ts` + `board-crud.ts` + `board-access.ts`

**Why:**
`services/board.ts` currently handles four distinct responsibilities:
1. **DB↔App type mapping** (`dbToObject`, `objectToDb`, `dbToConnector`, `BoardMetadata`, `BoardMember`, etc.) — ~80 lines
2. **Board-level CRUD** (`createBoard`, `getUserBoards`, `updateBoardMetadata`, `softDeleteBoard`, `touchBoard`) — ~130 lines
3. **Access control** (`joinBoard`, `getBoardMembers`, `requestBoardAccess`, `listBoardAccessRequests`, `resolveBoardAccessRequest`, `removeBoardMember`, `updateBoardVisibility`, `getInviteToken`, `acceptInviteToken`) — ~240 lines
4. **Object & Connector CRUD** (`fetchBoardObjects`, `createObject`, `createObjects`, `updateObject`, `updateObjectsBulk`, `deleteObject`, `restoreObject`, `restoreObjects`, `deleteFrameCascade`, `fetchBoardConnectors`, `createConnector`, `restoreConnector`, `updateConnector`, `deleteConnector`) — ~220 lines

The split:

| New File | Contents | ~Lines |
|---|---|---|
| `services/board-types.ts` | `dbToObject`, `objectToDb`, `dbToConnector`, `BoardMetadata`, `BoardMember`, `BoardAccessRequest`, `JoinResult` interfaces | ~80 |
| `services/board-crud.ts` | Board CRUD + Object CRUD + Connector CRUD (all Supabase queries) | ~350 |
| `services/board-access.ts` | `joinBoard`, member/invite/access-request management (API calls) | ~240 |

**Benefits:**
- When working on access control features, you open `board-access.ts`. When working on object manipulation, you open `board-crud.ts`. No more scrolling through 673 lines.
- The type mapping functions are shared by both `board-crud.ts` and `hooks/useBoard.ts`, so extracting them into `board-types.ts` eliminates the current duplication (yes, `useBoard.ts` has its own copies of `dbToObject` and `dbToConnector`!).
- The `useBoard.ts` hook's duplicated mapper functions can be replaced with imports from `board-types.ts`.

### 5.6 Components — No Structural Changes

The `components/` directory is already well-organized:
- `canvas/` — all Konva rendering components ✓
- `auth/` — authentication ✓
- `board/` — board settings ✓
- `sidebar/` — sidebar panels ✓
- `toolbar/` — toolbar ✓
- `ui/` — generic UI components ✓

I considered moving `RemoteCursor.tsx` and `RemoteCursorsLayer.tsx` into a `components/presence/` folder, but they're tightly integrated with the canvas `<Stage>` rendering and are imported by `Board.tsx` alongside all other canvas components. Moving them would create a false separation.

### 5.7 Pages — No Changes

`BoardPage.tsx` (732 lines) and `HomePage.tsx` (690 lines) are both large, but they're page-level coordinators that wire together many hooks and components. Their size comes from the breadth of features they orchestrate, not from doing too many things at the wrong abstraction level. Both are already well-structured with extracted hooks and memoized sub-components.

---

## 6. File Merge & Split Proposals

### 6.1 MERGE: `text-fit.ts` + `text-overlay-layout.ts` + `text-style.ts` → `text.ts`

**Merged file structure:**
```typescript
// utils/text.ts

// ─── Constants ──────────────────────────────────────────────
export const FRAME_TITLE_FONT_MIN = 10;
export const FRAME_TITLE_FONT_MAX = 22;
export const FRAME_HEADER_MIN_HEIGHT = 32;
export const FRAME_HEADER_MAX_HEIGHT = 52;

// ─── Font Size Calculation (from text-fit.ts) ───────────────
export function calculateFontSize(...) { ... }

// ─── Text Style Resolution (from text-style.ts) ─────────────
export function isTextCapableObjectType(...) { ... }
export function getAutoContrastingTextColor(...) { ... }
export function getFrameAutoTitleFontSize(...) { ... }
export function clampTextSizeForType(...) { ... }
export function getFrameTitleFontSize(...) { ... }
export function getFrameHeaderHeight(...) { ... }
export function getAutoTextSize(...) { ... }
export function resolveObjectTextSize(...) { ... }

// ─── Text Overlay Layout (from text-overlay-layout.ts) ──────
export type VerticalAlign = "top" | "middle" | "bottom";
export function estimateVerticalPaddingTop(...) { ... }
```

**All exported names remain identical.** Only the import path changes.

### 6.2 MERGE: `frame-containment.ts` + `frame-create.ts` → `frame.ts`

**Merged file structure:**
```typescript
// utils/frame.ts

// ─── Frame Creation Gesture (from frame-create.ts) ───────────
export interface FrameGestureInput { ... }
export interface FrameGestureResult { ... }
export function computeFrameFromGesture(...) { ... }

// ─── Frame Containment (from frame-containment.ts) ───────────
export function getContainedObjectIds(...) { ... }
export function moveContainedObjects(...) { ... }
export function getFrameBounds(...) { ... }
export function snapToFrame(...) { ... }
export function constrainChildrenInFrame(...) { ... }
export function minFrameSizeForChildren(...) { ... }
export function getRectOverlapRatio(...) { ... }
export function shouldPopOutFromFrame(...) { ... }
export function pushRectOutsideFrame(...) { ... }
export function constrainObjectOutsideFrames(...) { ... }
```

### 6.3 SPLIT: `services/board.ts` → Three Files

See Section 5.5 for the detailed breakdown. The key benefit is eliminating the duplicated `dbToObject`/`dbToConnector` functions that currently exist in both `services/board.ts` and `hooks/useBoard.ts`.

### 6.4 Files That Are Fine As-Is (Not Too Big)

| File | Lines | Assessment |
|---|---|---|
| `Board.tsx` | 1097 | Large but appropriate — it's the canvas orchestrator that wires 8 hooks. AGENTS.md documents this architecture. Splitting would scatter related wiring logic. |
| `useDragSystem.ts` | 838 | Large but cohesive — handles single/group/bulk drag as one state machine. Splitting would break the shared refs and state. |
| `BoardPage.tsx` | 732 | Page coordinator — wires hooks + renders UI panels. Already extracted `useKeyboardShortcuts`, `useThumbnailCapture`, `useTextStyleHandlers`. |
| `HomePage.tsx` | 690 | Dashboard page — self-contained with its own state management. |
| `services/board.ts` | 673 | **SPLITTING** (see above). |
| `useBoard.ts` | 557 | Moderate — CRUD + realtime subscription. Will shrink slightly when deduped mappers are removed. |
| `AICommandInput.tsx` | 523 | AI command panel — complex but self-contained. |
| `BoardSettingsPanel.tsx` | 468 | Settings panel — complex but self-contained. |

---

## 7. Full File Move Map

This is the complete mapping from current path → new path. Files not listed here do not move.

### 7.1 Moved Files

| Current Path | New Path |
|---|---|
| `hooks/useDragSystem.ts` | `hooks/canvas/useDragSystem.ts` |
| `hooks/useFrameInteraction.ts` | `hooks/canvas/useFrameInteraction.ts` |
| `hooks/useLivePositions.ts` | `hooks/canvas/useLivePositions.ts` |
| `hooks/useObjectPartitioning.ts` | `hooks/canvas/useObjectPartitioning.ts` |
| `hooks/useViewportCulling.ts` | `hooks/canvas/useViewportCulling.ts` |
| `hooks/useConnectorDraw.ts` | `hooks/canvas/useConnectorDraw.ts` |
| `hooks/useDrawingTools.ts` | `hooks/canvas/useDrawingTools.ts` |
| `hooks/useInputHandling.ts` | `hooks/canvas/useInputHandling.ts` |
| `hooks/usePresence.ts` | `hooks/presence/usePresence.ts` |
| `hooks/useCursorInterpolation.ts` | `hooks/presence/useCursorInterpolation.ts` |

### 7.2 Merged Files

| Current Files | New File |
|---|---|
| `utils/text-fit.ts` + `utils/text-overlay-layout.ts` + `utils/text-style.ts` | `utils/text.ts` |
| `utils/frame-containment.ts` + `utils/frame-create.ts` | `utils/frame.ts` |

### 7.3 Split Files

| Current File | New Files |
|---|---|
| `services/board.ts` | `services/board-types.ts` + `services/board-crud.ts` + `services/board-access.ts` |

### 7.4 Unchanged Files

All other files remain in their current locations:
- `App.tsx`, `main.tsx`, `index.css`, `vite-env.d.ts`
- `types/board.ts`
- `services/supabase.ts`, `services/presence.ts`
- `hooks/useBoard.ts`, `hooks/useBoardMembershipGuard.ts`, `hooks/useCanvas.ts`, `hooks/useSelection.ts`, `hooks/useUndoRedo.ts`, `hooks/useKeyboardShortcuts.ts`, `hooks/useThumbnailCapture.ts`, `hooks/useTextStyleHandlers.ts`
- `utils/throttle.ts`, `utils/colors.ts`, `utils/selection.ts`, `utils/export.ts`
- All files in `pages/`, `components/`

---

## 8. Import Update Tracking

This section tracks every file that needs import path updates after the reorganization. **This is the critical section for not breaking anything.**

### 8.1 Changes From Moving Canvas Hooks to `hooks/canvas/`

**`components/canvas/Board.tsx`** — imports all 8 moved canvas hooks:
```
BEFORE: import { useObjectPartitioning } from "../../hooks/useObjectPartitioning";
AFTER:  import { useObjectPartitioning } from "../../hooks/canvas/useObjectPartitioning";
```
Same pattern for: `useViewportCulling`, `useLivePositions`, `useDragSystem`, `useConnectorDraw`, `useDrawingTools`, `useFrameInteraction`, `useInputHandling`

**Internal cross-imports within moved canvas hooks:**
- `useDragSystem.ts` imports from `./useUndoRedo` → changes to `../useUndoRedo`
- `useFrameInteraction.ts` imports from `./useCanvas` → changes to `../useCanvas`; `./useUndoRedo` → `../useUndoRedo`
- `useConnectorDraw.ts` imports types from `../components/canvas/Board` → changes to `../../components/canvas/Board`
- `useDrawingTools.ts` imports types from `../components/canvas/Board` → changes to `../../components/canvas/Board`; `./useUndoRedo` → `../useUndoRedo`
- `useInputHandling.ts` imports types from `../components/canvas/Board` → changes to `../../components/canvas/Board`; `./useUndoRedo` → `../useUndoRedo`
- `useObjectPartitioning.ts` imports from `../utils/text-style` → changes to `../../utils/text` (due to merge); `../utils/frame-containment` → `../../utils/frame`
- `useViewportCulling.ts` imports from `./useCanvas` → changes to `../useCanvas`
- `useLivePositions.ts` imports from `../utils/frame-containment` → changes to `../../utils/frame`
- `useDragSystem.ts` imports from `../utils/frame-containment` → changes to `../../utils/frame`
- `useFrameInteraction.ts` imports from `../utils/frame-containment` → changes to `../../utils/frame`
- `useDrawingTools.ts` imports from `../utils/frame-create` → changes to `../../utils/frame`

**`components/canvas/DrawingPreviews.tsx`** — imports types from moved hooks:
```
BEFORE: import type { ConnectorDrawState } from "../../hooks/useConnectorDraw";
AFTER:  import type { ConnectorDrawState } from "../../hooks/canvas/useConnectorDraw";

BEFORE: import type { DrawState } from "../../hooks/useDrawingTools";
AFTER:  import type { DrawState } from "../../hooks/canvas/useDrawingTools";
```

### 8.2 Changes From Moving Presence Hooks to `hooks/presence/`

**`components/canvas/Board.tsx`** — imports types from `usePresence`:
```
BEFORE: import type { RemoteUser } from "../../hooks/usePresence";
BEFORE: import type { CursorStore } from "../../hooks/usePresence";
AFTER:  import type { RemoteUser } from "../../hooks/presence/usePresence";
AFTER:  import type { CursorStore } from "../../hooks/presence/usePresence";
```

**`components/canvas/RemoteCursorsLayer.tsx`**:
```
BEFORE: import { useCursorInterpolation } from "../../hooks/useCursorInterpolation";
AFTER:  import { useCursorInterpolation } from "../../hooks/presence/useCursorInterpolation";

BEFORE: import type { CursorStore } from "../../hooks/usePresence";
AFTER:  import type { CursorStore } from "../../hooks/presence/usePresence";
```

**`components/sidebar/PresencePanel.tsx`**:
```
BEFORE: import type { RemoteUser } from "../../hooks/usePresence";
AFTER:  import type { RemoteUser } from "../../hooks/presence/usePresence";
```

**`pages/BoardPage.tsx`**:
```
BEFORE: import { usePresence } from "../hooks/usePresence";
AFTER:  import { usePresence } from "../hooks/presence/usePresence";
```

**`hooks/presence/useCursorInterpolation.ts`** (internal):
```
BEFORE: import type { CursorStore } from "./usePresence";
AFTER:  (stays the same — both files are now in the same folder)
```

### 8.3 Changes From Merging Text Utils

All consumers that import from `text-fit`, `text-overlay-layout`, or `text-style` will import from `text` instead.

**`utils/text.ts`** (internal): `text-style.ts` currently imports from `./text-fit`. After merge, this is an internal reference — no import needed.

**`components/canvas/Shape.tsx`**:
```
BEFORE: import { calculateFontSize } from "../../utils/text-fit";
BEFORE: import { resolveObjectTextSize, ... } from "../../utils/text-style";
AFTER:  import { calculateFontSize, resolveObjectTextSize, ... } from "../../utils/text";
```

**`components/canvas/StickyNote.tsx`**: Same pattern as Shape.tsx.

**`components/canvas/TextOverlay.tsx`**:
```
BEFORE: import { calculateFontSize } from "../../utils/text-fit";
BEFORE: import { resolveObjectTextSize, ... } from "../../utils/text-style";
BEFORE: import { estimateVerticalPaddingTop } from "../../utils/text-overlay-layout";
AFTER:  import { calculateFontSize, resolveObjectTextSize, ..., estimateVerticalPaddingTop } from "../../utils/text";
```

**`components/canvas/Frame.tsx`**:
```
BEFORE: import { getFrameTitleFontSize, ... } from "../../utils/text-style";
AFTER:  import { getFrameTitleFontSize, ... } from "../../utils/text";
```

**`components/canvas/Board.tsx`**:
```
BEFORE: import { getFrameHeaderHeight } from "../../utils/text-style";
AFTER:  import { getFrameHeaderHeight } from "../../utils/text";
```

**`hooks/useKeyboardShortcuts.ts`**:
```
BEFORE: import { isTextCapableObjectType, ... } from "../utils/text-style";
AFTER:  import { isTextCapableObjectType, ... } from "../utils/text";
```

**`hooks/useTextStyleHandlers.ts`**:
```
BEFORE: import { isTextCapableObjectType, ... } from "../utils/text-style";
AFTER:  import { isTextCapableObjectType, ... } from "../utils/text";
```

**`hooks/canvas/useObjectPartitioning.ts`** (already moved):
```
BEFORE (relative to new location): import { getFrameHeaderHeight, ... } from "../../utils/text-style";
AFTER:  import { getFrameHeaderHeight, ... } from "../../utils/text";
```

### 8.4 Changes From Merging Frame Utils

**`hooks/canvas/useDragSystem.ts`** (already moved):
```
BEFORE: import { constrainObjectOutsideFrames, shouldPopOutFromFrame } from "../../utils/frame-containment";
AFTER:  import { constrainObjectOutsideFrames, shouldPopOutFromFrame } from "../../utils/frame";
```

**`hooks/canvas/useFrameInteraction.ts`** (already moved):
```
BEFORE: import { constrainObjectOutsideFrames } from "../../utils/frame-containment";
AFTER:  import { constrainObjectOutsideFrames } from "../../utils/frame";
```

**`hooks/canvas/useLivePositions.ts`** (already moved):
```
BEFORE: import { shouldPopOutFromFrame } from "../../utils/frame-containment";
AFTER:  import { shouldPopOutFromFrame } from "../../utils/frame";
```

**`hooks/canvas/useObjectPartitioning.ts`** (already moved):
```
BEFORE: import { minFrameSizeForChildren } from "../../utils/frame-containment";
AFTER:  import { minFrameSizeForChildren } from "../../utils/frame";
```

**`hooks/canvas/useDrawingTools.ts`** (already moved):
```
BEFORE: import { computeFrameFromGesture } from "../../utils/frame-create";
AFTER:  import { computeFrameFromGesture } from "../../utils/frame";
```

**`components/canvas/Board.tsx`**:
```
BEFORE: import { constrainChildrenInFrame } from "../../utils/frame-containment";
AFTER:  import { constrainChildrenInFrame } from "../../utils/frame";
```

### 8.5 Changes From Splitting `services/board.ts`

**`services/board-crud.ts`** will import from `./board-types` and `./supabase`.

**`services/board-access.ts`** will import from `./board-types` and `./supabase`.

**`hooks/useBoard.ts`**:
```
BEFORE: import * as boardService from "../services/board";
AFTER:  import * as boardService from "../services/board-crud";
         // Also: import { dbToObject, dbToConnector } from "../services/board-types";
         // (replaces its own duplicated mapper functions)
```
The wildcard import `* as boardService` remains valid because `board-crud.ts` will export the same function names. The `createBoardRealtimeChannels` import from `../services/presence` stays unchanged.

**`pages/BoardPage.tsx`**:
```
BEFORE: import { joinBoard, touchBoard, fetchBoardMetadata, requestBoardAccess } from "../services/board";
AFTER:  import { touchBoard, fetchBoardMetadata } from "../services/board-crud";
         import { joinBoard, requestBoardAccess } from "../services/board-access";
```

**`pages/HomePage.tsx`**:
```
BEFORE: import { getUserBoards, createBoard, joinBoard, softDeleteBoard, removeBoardMember, getInviteToken, type BoardMetadata } from "../services/board";
AFTER:  import { getUserBoards, createBoard, softDeleteBoard, type BoardMetadata } from "../services/board-crud";
         import { joinBoard, removeBoardMember, getInviteToken } from "../services/board-access";
```
Note: `BoardMetadata` interface moves to `board-types.ts`, but it will be re-exported from `board-crud.ts` for convenience.

**`pages/InviteAcceptPage.tsx`**:
```
BEFORE: import { acceptInviteToken } from "../services/board";
AFTER:  import { acceptInviteToken } from "../services/board-access";
```

**`components/board/BoardSettingsPanel.tsx`**:
```
BEFORE: import { getBoardMembers, getInviteToken, listBoardAccessRequests, resolveBoardAccessRequest, removeBoardMember, updateBoardVisibility, type BoardMember, type BoardAccessRequest } from "../../services/board";
AFTER:  import { getBoardMembers, getInviteToken, listBoardAccessRequests, resolveBoardAccessRequest, removeBoardMember, updateBoardVisibility, type BoardMember, type BoardAccessRequest } from "../../services/board-access";
```
(All of BoardSettingsPanel's board.ts imports are access-control functions — they all go to `board-access.ts`.)

**`utils/export.ts`**:
```
(imports only types from ../types/board — no change needed)
```

---

## 9. Test File Reorganization

Test files mirror the source structure under `test/`. They should be updated to match:

### 9.1 Moved Test Files

| Current Path | New Path |
|---|---|
| `test/hooks/useDragSystem.test.ts` | `test/hooks/canvas/useDragSystem.test.ts` |
| `test/hooks/usePresence.test.ts` | `test/hooks/presence/usePresence.test.ts` |
| `test/hooks/useCursorInterpolation.test.ts` | `test/hooks/presence/useCursorInterpolation.test.ts` |
| `test/hooks/useViewportCulling.test.ts` | `test/hooks/canvas/useViewportCulling.test.ts` |

### 9.2 Merged Test Files

| Current Files | New File |
|---|---|
| `test/utils/text-fit.test.ts` + `test/utils/text-overlay-layout.test.ts` + `test/utils/text-style.test.ts` | `test/utils/text.test.ts` |
| `test/utils/frame-containment.test.ts` + `test/utils/frame-create.test.ts` | `test/utils/frame.test.ts` |

### 9.3 Split Test Files

| Current File | New Files |
|---|---|
| `test/services/board.test.ts` | `test/services/board-crud.test.ts` + `test/services/board-access.test.ts` |

### 9.4 Tests That Need Import Path Updates

All test files that import from moved/merged/split source files need their import paths updated. The import changes follow the exact same patterns as Section 8 above. For example:

```
// test/hooks/canvas/useDragSystem.test.ts
BEFORE: import { useDragSystem } from "../../hooks/useDragSystem";
AFTER:  import { useDragSystem } from "../../../hooks/canvas/useDragSystem";
```

Every test file's imports will be audited and updated as part of the migration.

---

## 10. Migration Strategy & Risk Mitigation

### 10.1 Execution Order

The changes should be applied in this order to minimize broken intermediate states:

1. **Split `services/board.ts`** — This is the most complex change. Create the new files, move functions, update all importers. Run tests.

2. **Merge util files** — Create `utils/text.ts` and `utils/frame.ts` by concatenating contents. Update all import paths. Delete old files. Run tests.

3. **Move canvas hooks** — Create `hooks/canvas/` directory, move files, update all import paths (Board.tsx + internal cross-imports). Run tests.

4. **Move presence hooks** — Create `hooks/presence/` directory, move files, update all import paths. Run tests.

5. **Move test files** — Mirror the source structure changes in `test/`. Update test import paths. Run tests.

6. **Clean up** — Remove any old empty directories, verify all 509 tests pass, verify `npm run build` succeeds.

### 10.2 Verification After Each Step

After each step:
1. `npx tsc --noEmit` — TypeScript compilation check (catches broken imports)
2. `npm test` — Run all 509 tests
3. `npm run build` — Verify production build succeeds
4. Manual quick check — Open the app, create a board, drag objects, verify presence

### 10.3 Git Strategy

Each step should be a separate, atomic commit:
1. `refactor: split services/board.ts into board-types, board-crud, board-access`
2. `refactor: merge text-fit + text-overlay-layout + text-style into utils/text`
3. `refactor: merge frame-containment + frame-create into utils/frame`
4. `refactor: move canvas-only hooks to hooks/canvas/`
5. `refactor: move presence hooks to hooks/presence/`
6. `refactor: reorganize test files to mirror source structure`

This way, if any step introduces a bug, `git bisect` can pinpoint it instantly.

### 10.4 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Broken import paths | Medium | High | TypeScript compiler will catch immediately; run `tsc --noEmit` after each step |
| Test import paths wrong | Medium | Medium | Tests run after each step; fix immediately |
| Circular dependency introduced | Low | High | The moves only add nesting depth, not new cross-references |
| Dynamic imports broken | Low | High | Only `BoardPage` uses `lazy()` in `App.tsx` — that import path doesn't change |
| AGENTS.md becomes stale | Certain | Medium | Update AGENTS.md file index table (Section 12) |

---

## 11. Files NOT Moved (and Why)

### `hooks/useBoard.ts` — Stays in `hooks/`
Although it's the largest hook, it's used by `BoardPage.tsx` (the page coordinator), not by `Board.tsx` (the canvas). It's a page-level hook that manages the Supabase data layer.

### `hooks/useCanvas.ts` — Stays in `hooks/`
Used by `BoardPage.tsx` and its return value is passed as a prop to `Board.tsx`. It's a page-level hook despite being canvas-related.

### `hooks/useKeyboardShortcuts.ts` — Stays in `hooks/`
Used by `BoardPage.tsx`, not by `Board.tsx`.

### `hooks/useTextStyleHandlers.ts` — Stays in `hooks/`
Used by `BoardPage.tsx` to derive text style state for the `TextStylePanel`.

### `utils/selection.ts` — Stays in `utils/`
Generic geometry functions (rectangle intersection, line-rect tests). Used by both `Board.tsx` and could be used elsewhere. Not specific to any domain.

### `utils/throttle.ts` — Stays in `utils/`
A fully generic utility function with no domain-specific logic. Used only by `usePresence` currently, but could be used anywhere.

### `utils/colors.ts` — Stays in `utils/`
Color constants and getters used across multiple components (Toolbar, BoardPage, presence). App-wide concern.

### `utils/export.ts` — Stays in `utils/`
Export utilities (PNG, SVG, JSON). Self-contained, used only by `ExportMenu.tsx`.

### `components/canvas/*` — All stay
The canvas components are already well-grouped. The 17 files in this directory are all Konva rendering components consumed by `Board.tsx`. No reorganization needed.

---

## 12. AGENTS.md Updates Required

After the reorganization, the following sections of `AGENTS.md` need updating:

### 12.1 File Index Table

The file paths in the "File Index" table at the bottom of AGENTS.md must be updated to reflect the new locations:

```markdown
| File | Purpose |
|---|---|
| `src/hooks/canvas/useDragSystem.ts` | Drag orchestration (single/group/bulk) |
| `src/hooks/canvas/useFrameInteraction.ts` | Frame header drag + resize push |
| `src/hooks/presence/usePresence.ts` | Cursor broadcast + online user list |
| `src/utils/frame.ts` | Frame containment + creation logic |
| `src/utils/text.ts` | Text size resolution, auto-contrast, frame title sizing |
| `src/services/board-crud.ts` | Object/connector/board CRUD operations |
| `src/services/board-access.ts` | Board access control (join, invites, members) |
| `src/services/board-types.ts` | DB↔App type mapping, shared interfaces |
```

### 12.2 Architecture Diagram

The hook hierarchy in the "High-Level Architecture" section should group the canvas hooks:

```
BoardPage (page coordinator)
  ├── useBoard            — CRUD + Supabase Realtime sync
  ├── usePresence         — [hooks/presence/] cursor broadcasting + user list
  ├── useCanvas           — zoom, pan, viewport state
  ├── useSelection        — selected object IDs + multi-select
  ├── useUndoRedo         — undo/redo stack
  ├── useKeyboardShortcuts
  ├── useThumbnailCapture
  ├── useTextStyleHandlers
  └── Board (canvas orchestrator)
        ├── [hooks/canvas/] useObjectPartitioning
        ├── [hooks/canvas/] useViewportCulling
        ├── [hooks/canvas/] useLivePositions
        ├── [hooks/canvas/] useDragSystem
        ├── [hooks/canvas/] useConnectorDraw
        ├── [hooks/canvas/] useDrawingTools
        ├── [hooks/canvas/] useFrameInteraction
        └── [hooks/canvas/] useInputHandling
```

---

## Summary of Changes

| Category | Count | Description |
|---|---|---|
| Files moved | 10 | 8 canvas hooks + 2 presence hooks |
| Files merged | 5 → 2 | 3 text utils → 1, 2 frame utils → 1 |
| Files split | 1 → 3 | `services/board.ts` → 3 files |
| Files unchanged | ~45 | Everything else |
| Import updates | ~35 files | Source files + test files |
| Net file count change | -1 | 5 merged into 2 = -3, 1 split into 3 = +2, moves = 0 → net = -1 |
| Max nesting depth | 2 | `src/hooks/canvas/useDragSystem.ts` |

The result is a structure where **functional relationships are immediately visible from the folder tree**, without requiring developers to open files and trace imports to understand what goes with what.
