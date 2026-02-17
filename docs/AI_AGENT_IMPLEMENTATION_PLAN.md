# AI Agent Implementation Plan (Vercel Serverless + Firebase RTDB)

**Status:** Active  
**Last Updated:** February 16, 2026  
**Decision:** Vercel AI endpoint (Firebase billing card blocks Cloud Functions/Blaze). Firebase Auth + RTDB remain for realtime board state and multiplayer. Only the AI "backend" lives at `/api/ai-agent`.

---

## Non-Negotiable Requirements

1. **Do not trust userId from the client.** Derive `uid` from the verified Firebase ID token on the server. Ignore any request `userId`.

2. **Server must enforce board authorization.** Because Vercel uses `firebase-admin` (bypasses RTDB rules), the endpoint must check: the board exists AND the caller is allowed to mutate it (membership model via `userBoards/{uid}/{boardId}`).

3. **Viewport awareness uses bounds, not just center.** Send `{minX, minY, maxX, maxY, centerX, centerY, scale}` in canvas coordinates, based on the stage container size (not `window.innerWidth/Height`).

4. **Don't rely on the LLM to "avoid overlapping" by itself.** Add deterministic placement logic server-side: `resolvePlacement()` helper used inside create tools.

5. **Guardrails are required.** Hard caps: max tool calls (25), max objects created (25), clamp sizes/coords, sanitize text length, timeout OpenAI calls.

6. **Add idempotency.** Include a `commandId` (uuid) from the client so retries don't duplicate templates. Store `aiRuns/{boardId}/{commandId}` with status.

7. **Instrument usage for cost analysis.** Store model + token usage + tool calls count + duration for each AI command at `aiLogs/{boardId}/{runId}`.

---

## Architecture

### Request Flow

```
Client:
  → Gets Firebase ID token (anonymous or Google)
  → Computes viewport bounds in canvas coordinates + selection info
  → POSTs to /api/ai-agent with Authorization: Bearer <idToken>

Server (/api/ai-agent.ts):
  → Verify ID token → uid
  → Authorize uid on boardId
  → Check idempotency (aiRuns/{boardId}/{commandId})
  → Load scoped board state (viewport + selected objects + recent)
  → Call OpenAI with tool schema
  → Execute tool calls → writes to RTDB
  → Log usage to aiLogs/{boardId}/{runId}
  → Return response: message, affected ids, focus bounds

Realtime:
  → All clients see the writes via existing RTDB listeners immediately
```

---

## Types

### Client → Server Payload

```typescript
export type Viewport = {
  minX: number; minY: number; maxX: number; maxY: number;
  centerX: number; centerY: number;
  scale: number;
};

export type AICommandRequest = {
  commandId: string;        // uuid for idempotency
  boardId: string;
  command: string;
  viewport: Viewport;
  selectedObjectIds: string[];
  pointer?: { x: number; y: number }; // optional canvas coords of cursor
};
```

### Server → Client Response

```typescript
export type AICommandResponse = {
  success: boolean;
  message: string;
  objectsCreated: string[];
  objectsUpdated: string[];
  objectsDeleted: string[];
  focus?: { minX: number; minY: number; maxX: number; maxY: number };
  runId: string;
};
```

### Viewport Computation (Client)

```typescript
const stage = stageRef.current;
const rect = stage.container().getBoundingClientRect();
const sx = stage.scaleX();
const sy = stage.scaleY();

const minX = (-stage.x()) / sx;
const minY = (-stage.y()) / sy;
const maxX = (-stage.x() + rect.width) / sx;
const maxY = (-stage.y() + rect.height) / sy;

const viewport: Viewport = {
  minX, minY, maxX, maxY,
  centerX: (minX + maxX) / 2,
  centerY: (minY + maxY) / 2,
  scale: sx,
};
```

---

## Server File Structure (Vercel)

```
api/
  ai-agent.ts                    # POST handler: verify, authorize, orchestrate, respond
  _lib/
    firebaseAdmin.ts             # firebase-admin singleton init
    auth.ts                      # verifyIdToken → uid
    boardState.ts                # getBoardStateForAI(boardId, viewport, selectedIds)
    placement.ts                 # resolvePlacement(desiredX, desiredY, w, h, viewport, objects)
    ai/
      agent.ts                   # OpenAI tool loop (orchestration)
      tools.ts                   # Tool implementations (RTDB writes)
      toolSchemas.ts             # OpenAI function definitions
```

### Environment Variables (Vercel)

- `OPENAI_API_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (replace `\\n` with real newlines in code)
- `FIREBASE_DATABASE_URL`

### Dependencies (install in root package.json)

- `firebase-admin`
- `openai`

---

## Authentication + Authorization

### Verify Token

```typescript
import { getAuth } from "firebase-admin/auth";
const decoded = await getAuth().verifyIdToken(idToken);
const uid = decoded.uid;
```

### Board Authorization: `assertCanWriteBoard(uid, boardId)`

1. Check `boards/{boardId}/metadata` exists → 404 if not
2. Check `userBoards/{uid}/{boardId}` exists → 403 if not (membership required)
3. Only then proceed with tool execution

---

## Board State Context Strategy

### `getBoardStateForAI(boardId, viewport, selectedIds)`

- **Always include** selected objects (by ID)
- **Include** all objects intersecting viewport expanded by margin (+400px each side)
- **Optionally include** recently modified (last N = 50–100 by updatedAt)
- **Include** connectors referencing any included objects
- **Exclude** presence data (not needed for AI)

Return compact normalized list:
```json
[{"id","type","x","y","width","height","color","text","rotation","zIndex","parentFrameId"}]
```

---

## Placement: Make "On Screen" Reliable

### `resolvePlacement(desiredX, desiredY, w, h, viewport, existingObjects)`

1. Start at `(desiredX, desiredY)` — usually viewport center
2. Spiral/grid search outward in steps (e.g., 40px) within radius (e.g., 1200px)
3. Choose first non-overlapping rectangle (no intersection with existing objects)
4. Clamp into reasonable range near viewport

**Used inside create tools** so even if the model picks a bad spot, we correct it. This avoids adding a tool while making placement consistent.

---

## Tool Schema (PRD Minimum)

### Required Tools (9)

| Tool | Description |
|------|-------------|
| `createStickyNote(text, x, y, color)` | Creates sticky note, returns objectId |
| `createShape(type, x, y, width, height, color)` | Creates rectangle/circle/line |
| `createFrame(title, x, y, width, height)` | Creates named frame container |
| `createConnector(fromId, toId, style)` | Creates arrow/line between objects |
| `moveObject(objectId, x, y)` | Moves object to new position |
| `resizeObject(objectId, width, height)` | Resizes object |
| `updateText(objectId, newText)` | Updates text content |
| `changeColor(objectId, color)` | Changes fill color |
| `getBoardState()` | Returns current board objects for context |

### Optional Tools (add after required commands work)

| Tool | Description |
|------|-------------|
| `deleteObject(objectId)` | Deletes an object (guarded) |
| `deleteConnector(connectorId)` | Deletes a connector |

---

## OpenAI Orchestration

### Guardrails

| Guardrail | Value |
|-----------|-------|
| Max iterations | 4–6 |
| Max total tool calls | 25 |
| Max objects created per command | 25 |
| Min object size | 50×50 |
| Max object size | 2000×2000 |
| Max text length | 500 chars |
| Coordinate clamp | ±50000 |
| OpenAI timeout | 25 seconds |

### Model Selection

- **Default:** `gpt-4o-mini` (fast, cheap)
- **Complex templates:** `gpt-4o` when command matches template keywords (SWOT, retro, journey map, kanban, etc.) or requires many steps
- **Heuristic:** keyword match on command string

### Idempotency

- Save `aiRuns/{boardId}/{commandId}` with `{ status: "started" | "completed", response, startedAt }`
- If same `commandId` repeats, return prior result instead of re-running
- Clean up runs older than 1 hour (optional)

### Usage Logging

Save to `aiLogs/{boardId}/{runId}`:
```json
{
  "uid": "...",
  "model": "gpt-4o-mini",
  "inputTokens": 1234,
  "outputTokens": 567,
  "totalTokens": 1801,
  "toolCallsCount": 8,
  "objectsCreated": 4,
  "objectsUpdated": 0,
  "durationMs": 2340,
  "command": "Create a SWOT analysis",
  "timestamp": 1234567890
}
```

---

## Client UX

### Flow

1. User types command → hits Send (or Enter)
2. Panel shows "Thinking..." spinner with command echoed
3. AI executes server-side → Firebase writes happen → objects appear via existing listeners
4. Panel shows success: message + counts
5. **Auto-focus result:**
   - Wait until `objectsCreated` IDs exist in local `objects` state
   - Compute bounding box of created objects
   - Smooth-pan stage to center that box (or use `focus` bounds from response)
   - Select created objects

### Skip

- Streaming per tool call (not needed)
- Rich conversation history (nice-to-have, not required)

---

## Required Commands (6+ from PRD)

### Creation (3)

| Command | Expected Behavior |
|---------|-------------------|
| "Add a yellow sticky note that says 'User Research'" | Creates 1 sticky near viewport center |
| "Create a blue rectangle" | Creates 1 rectangle near viewport center |
| "Add a frame called 'Sprint Planning'" | Creates 1 frame near viewport center |

### Manipulation (3)

| Command | Expected Behavior |
|---------|-------------------|
| "Move all the pink sticky notes to the right side" | getBoardState → filter → moveObject each |
| "Change the sticky note color to green" | getBoardState → identify → changeColor |
| "Resize the frame to fit its contents" | getBoardState → calculate bounds → resizeObject |

### Layout (2)

| Command | Expected Behavior |
|---------|-------------------|
| "Arrange these sticky notes in a grid" | getBoardState → calculate grid → moveObject each |
| "Space these elements evenly" | getBoardState → calculate spacing → moveObject each |

### Complex Templates (3)

| Command | Expected Behavior |
|---------|-------------------|
| "Create a SWOT analysis template" | 4 frames (quadrant) + 4 labeled stickies |
| "Build a user journey map with 5 stages" | 5 frames + 5 stickies + 4 connectors |
| "Set up a retrospective board" | 3 frames + 3 placeholder stickies |

---

## Implementation Order (Fastest Path)

| Step | Task | Notes |
|------|------|-------|
| **1** | Create `/api/ai-agent.ts`: verify token, authorize, stub response | Endpoint exists and returns 200 |
| **2** | Wire client `fetch("/api/ai-agent")` + send commandId, viewport, selectedObjectIds | Client can call endpoint |
| **3** | Port tool implementations to `/api/_lib/ai/tools.ts` (RTDB writes) | Tools write to Firebase |
| **4** | Implement board state loader (scoped to viewport + selection) | AI gets context |
| **5** | Implement placement resolver, enforce inside create tools | Objects appear on screen |
| **6** | Implement OpenAI tool loop (limits, validation, logging) | AI commands execute |
| **7** | Make 6+ required commands pass + 1 complex template (SWOT or retro) | PRD compliance |
| **8** | Add client auto-pan/auto-select | UX: user sees results |
| **9** | Add idempotency + rate limiting | Production safety |
| **10** | Optional: delete tools, richer UI history | Polish |

---

## System Prompt

```
You are an AI assistant that manipulates a collaborative whiteboard. You have tools for creating and manipulating board objects.

Current board state and the user's viewport are provided as context. Use them to:
- Understand existing objects when the user references them
- Place new objects within or near the user's current view
- Avoid overlapping existing objects

The user's viewport in canvas coordinates:
  Top-left: ({minX}, {minY})
  Bottom-right: ({maxX}, {maxY})
  Center: ({centerX}, {centerY})
  Zoom: {scale}x

{selectedObjectIds.length > 0 ? "Selected objects: " + selectedObjectIds.join(", ") : "No objects selected."}

For complex commands (SWOT, retro, journey map), plan tool calls to create a well-organized layout centered near ({centerX}, {centerY}). Use consistent spacing (220px between objects, 300px between frames).

Available colors: yellow (#FBBF24), pink (#F472B6), blue (#3B82F6), green (#22C55E), orange (#F97316), purple (#A855F7), red (#EF4444), gray (#9CA3AF), white (#FFFFFF).

Always respond with tool calls. Do not respond with text-only messages.
```

---

## Environment Setup Checklist

- [ ] `npm install firebase-admin openai` in root
- [ ] Generate Firebase service account key from Firebase Console
- [ ] Add to Vercel env vars: `OPENAI_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_URL`
- [ ] Test endpoint locally with `vercel dev`
- [ ] Verify token flow works with anonymous + Google auth
