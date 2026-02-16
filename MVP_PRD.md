# CollabBoard — MVP Product Requirements Document

**Version:** 1.0  
**Date:** February 16, 2026  
**Sprint:** 7 days | MVP Gate: 24 hours  
**Author:** [Your Name]  
**Status:** Active — MVP Sprint

---

## 1. Executive Summary

CollabBoard is a real-time collaborative whiteboard that enables multiple users to brainstorm, map ideas, and run workshops simultaneously on an infinite canvas. An AI agent extends the board with natural language commands for creating templates, rearranging elements, and building complex layouts.

**North Star:** A simple, solid, multiplayer whiteboard with a working AI agent beats any feature-rich board with broken collaboration.

**Product Scope:** Route 1 — Collab Core + AI Templates. Nail collaboration stability and sync correctness. Add AI template commands for differentiation. Keep feature scope tight.

---

## 2. Technical Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend Framework | React 18+ with Vite | Fast build, excellent ecosystem, best AI code-gen support |
| Language | TypeScript (strict mode) | Catches real-time sync bugs at compile time |
| Styling | Tailwind CSS | Utility-first, rapid prototyping |
| Canvas Rendering | Konva.js via `react-konva` | Declarative canvas maps cleanly to React component model |
| Routing | TanStack Router | Type-safe routing for `/board/:boardId` |
| Real-Time Sync | Firebase Realtime DB | Built-in listeners, presence system, optimized for frequent small writes |
| Authentication | Firebase Auth (Anonymous + Google) | Zero-friction for evaluators; persistent identity optional |
| AI Agent Backend | Firebase Cloud Functions | Serverless; keeps OpenAI API key server-side |
| AI Model | OpenAI GPT-4o (function calling) | Battle-tested tool calling, mature ecosystem |
| Frontend Hosting | Vercel | Instant deploys, auto-deploy from GitHub main branch |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────┐
│                    Vercel                         │
│              (Frontend Hosting)                   │
│                                                   │
│  React + Vite + Tailwind + TypeScript (strict)   │
│  react-konva (Canvas Rendering)                  │
│  TanStack Router (Navigation)                    │
│  Firebase SDK (Auth + Realtime DB)               │
└──────────────┬──────────────────┬────────────────┘
               │                  │
               │ Direct SDK       │ HTTPS
               │ (real-time)      │ (AI commands)
               ▼                  ▼
┌──────────────────────┐  ┌─────────────────────┐
│  Firebase Realtime DB │  │ Firebase Cloud       │
│                       │  │ Functions            │
│  • boards/objects     │  │                      │
│  • presence/cursors   │  │  → OpenAI GPT-4o     │
│  • users              │  │  → Tool execution    │
│                       │  │  → Firebase writes   │
│  Firebase Auth        │  │                      │
│  (Anonymous + Google) │  └─────────────────────┘
└───────────────────────┘
```

**Data flows:**
- Client ↔ Firebase Realtime DB: direct SDK reads/writes for objects, cursors, presence
- Client → Firebase Cloud Function → OpenAI GPT-4o → Firebase writes: AI agent commands
- No traditional backend server. The only server-side code is one Cloud Function for AI.

---

## 4. Database Schema

```
boards/
  {boardId}/
    metadata/
      title: string
      createdAt: number (timestamp)
      ownerId: string
    objects/
      {objectId}/
        id: string
        type: "sticky" | "rectangle" | "circle" | "line" | "frame" | "text"
        x: number
        y: number
        width: number
        height: number
        color: string (hex)
        text: string (optional, for sticky/text/frame)
        rotation: number (degrees, default 0)
        zIndex: number
        createdBy: string (userId)
        createdAt: number (timestamp)
        updatedAt: number (timestamp)
    connectors/
      {connectorId}/
        id: string
        fromId: string (objectId)
        toId: string (objectId)
        style: "arrow" | "line"
        points: number[] (optional, for custom paths)

presence/
  {boardId}/
    {userId}/
      displayName: string
      cursorColor: string (hex, assigned on join)
      cursor:
        x: number
        y: number
      online: boolean
      lastSeen: number (timestamp)
      editingObjectId: string | null

users/
  {userId}/
    displayName: string
    email: string | null
    photoURL: string | null
    authMethod: "anonymous" | "google"
```

**Design decisions:**
- **Flat, denormalized schema.** Each object is its own Firebase node so only changed objects sync, not the entire board.
- **Presence is a separate root path** from board objects to isolate high-frequency cursor writes from object data.
- **Conflict resolution:** Last-write-wins (Firebase default). Acceptable per project spec. See Section 8 for behavioral details.
- **Persistence:** Firebase Realtime DB persists all data automatically. Board state survives all users leaving and returning.

---

## 5. Project Structure

```
collabboard/
├── src/
│   ├── components/
│   │   ├── canvas/
│   │   │   ├── Board.tsx              # Main Konva Stage + Layer, pan/zoom, renders all objects
│   │   │   ├── StickyNote.tsx         # Konva Rect + Text, draggable, double-click to edit
│   │   │   ├── Shape.tsx              # Rectangle, circle, line rendering
│   │   │   ├── Frame.tsx              # Named container with title
│   │   │   ├── Connector.tsx          # Line/arrow between two objects
│   │   │   ├── RemoteCursor.tsx       # Other users' cursor arrow + name label
│   │   │   ├── SelectionRect.tsx      # Drag-to-select rectangle overlay
│   │   │   └── TextOverlay.tsx        # HTML textarea positioned over canvas for editing
│   │   ├── toolbar/
│   │   │   ├── Toolbar.tsx            # Tool selection (select, sticky, shape, frame)
│   │   │   ├── ColorPicker.tsx        # Color selection for objects
│   │   │   └── ShapeSelector.tsx      # Shape type picker (rect, circle, line)
│   │   ├── sidebar/
│   │   │   ├── PresencePanel.tsx      # Online users list with colored dots
│   │   │   └── AICommandInput.tsx     # Natural language input for AI agent
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx          # Anonymous + Google sign-in
│   │   │   └── AuthProvider.tsx       # Firebase Auth context wrapper
│   │   └── ui/
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       └── Modal.tsx
│   ├── hooks/
│   │   ├── useBoard.ts               # Board object CRUD + Firebase real-time listeners
│   │   ├── usePresence.ts            # Online users, onDisconnect, reconnect handling
│   │   ├── useCursors.ts             # Throttled cursor position broadcasting
│   │   ├── useAIAgent.ts             # AI command submission + response handling
│   │   ├── useCanvas.ts              # Pan, zoom, viewport state management
│   │   └── useSelection.ts           # Object selection state (single + multi)
│   ├── services/
│   │   ├── firebase.ts               # Firebase app init, DB/Auth exports
│   │   ├── board.ts                  # Firebase RTDB operations: create, update, delete objects
│   │   ├── presence.ts               # Presence operations: join, leave, cursor update, onDisconnect
│   │   └── ai-agent.ts               # Cloud Function client: send command, receive response
│   ├── types/
│   │   ├── board.ts                  # BoardObject, StickyNote, Shape, Connector, Frame, etc.
│   │   ├── presence.ts               # UserPresence, CursorPosition
│   │   └── ai.ts                     # AICommand, AIResponse, ToolCall
│   ├── utils/
│   │   ├── colors.ts                 # Color palettes, random color assignment
│   │   ├── geometry.ts               # Position, size, bounding box, intersection math
│   │   ├── throttle.ts               # Cursor + drag update throttling utilities
│   │   └── ids.ts                    # Firebase push ID generation helpers
│   ├── App.tsx                       # Root component
│   ├── main.tsx                      # Entry point
│   └── router.tsx                    # TanStack Router config: /, /board/:boardId
├── functions/
│   ├── src/
│   │   ├── index.ts                  # Cloud Function entry: onRequest handler
│   │   ├── ai-agent.ts              # OpenAI API call with tool schemas, parse response
│   │   └── tools.ts                  # Tool implementations: createStickyNote, moveObject, etc.
│   ├── package.json
│   └── tsconfig.json
├── public/
├── firebase.json                     # Firebase project config
├── .firebaserc                       # Firebase project alias
├── database.rules.json               # Realtime DB security rules
├── vite.config.ts
├── tsconfig.json                     # strict: true
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── .eslintrc.cjs
├── .prettierrc
└── README.md
```

---

## 6. MVP Requirements (24-Hour Hard Gate)

Every item below MUST pass. No partial credit. This is a hard gate for project progression.

### 6.1 MVP Checklist

| # | Requirement | Implementation | Acceptance Test |
|---|------------|----------------|-----------------|
| 1 | Infinite board with pan/zoom | Konva `Stage` with `draggable={true}` + `onWheel` zoom handler. Viewport state in `useCanvas` hook. Zoom range 10%–400%. | Open board → drag to pan → scroll to zoom. Canvas moves smoothly at 60 FPS. No bounds hit. |
| 2 | Sticky notes with editable text | `StickyNote` component: Konva `Rect` + `Text`. Double-click mounts HTML `<textarea>` overlay at transformed canvas coordinates. Text committed to Firebase on blur or Enter. | Create sticky → double-click → type text → click away → text persists. Refresh page → text still there. |
| 3 | At least one shape type | `Shape` component supporting rectangles via Konva `Rect`. Default size and color on creation. | Select rectangle tool → click canvas → rectangle appears with default size/color. |
| 4 | Create, move, edit objects | Create via toolbar click + canvas click. Move via Konva `draggable={true}`. Edit via double-click (text) or property panel (color). | Create sticky → drag it → edit text → change color → all changes persist across refresh. |
| 5 | Real-time sync between 2+ users | Firebase RTDB listeners on `boards/{boardId}/objects/`: `onChildAdded`, `onChildChanged`, `onChildRemoved` update local React state. | Browser A creates sticky → Browser B sees it within <100ms. Browser B moves it → Browser A sees movement. |
| 6 | Multiplayer cursors with name labels | Each user writes throttled (30–50ms) cursor position to `presence/{boardId}/{userId}/cursor`. All clients listen and render `RemoteCursor` components. | Browser A moves mouse → Browser B sees labeled cursor following within <50ms. |
| 7 | Presence awareness (who's online) | `presence/{boardId}/{userId}/online` set `true` on connect, `false` via `onDisconnect()`. `PresencePanel` shows online users with colored dots. | Browser A joins → B sees "User A" in list. A closes tab → B sees A disappear within seconds. |
| 8 | User authentication | Firebase Auth: Anonymous Auth with display name prompt as primary. Google sign-in as secondary. `AuthProvider` wraps app, redirects to `LoginPage` if unauthenticated. | Open app → enter display name → "Continue as Guest" → land on board. Or sign in with Google. |
| 9 | Deployed and publicly accessible | Frontend on Vercel (auto-deploy from GitHub). Firebase Realtime DB + Auth + Cloud Functions on Firebase Blaze plan. | Share URL → anyone can authenticate and join the board. |

### 6.2 MVP Priority: What to Cut if Behind

If time pressure at hour 20, cut in this order (bottom first):
1. ~~Property panel for color changes~~ → use default colors only
2. ~~Shape type (rectangle)~~ → sticky notes only (spec says "at least one shape type" so this is risky)
3. ~~Google sign-in~~ → anonymous auth only (still satisfies "user authentication")

**Never cut:** Real-time sync, cursors, presence, persistence, deploy. These ARE the MVP.

---

## 7. Real-Time Data Flow & Throttling Rules

### 7.1 Cursor Sync

- **Write path:** `presence/{boardId}/{userId}/cursor` → `{x: number, y: number}`
- **Throttle:** 30–50ms interval (20–33 updates/second per user)
- **Listener:** All clients subscribe to `presence/{boardId}/` with `onChildChanged`
- **Rendering:** `RemoteCursor` component — lightweight Konva `Arrow` + `Text` outside the main object `Layer`
- **Target latency:** <50ms end-to-end

### 7.2 Object Drag Sync

- **Strategy:** Throttled writes every ~80ms during drag + final write on drag end
- **Write path:** `boards/{boardId}/objects/{objectId}` → update `x`, `y` fields
- **Local authority rule:** While User A is dragging object X, User A's client **ignores incoming remote position updates for object X**. This prevents jitter from round-trip lag. On `onDragEnd`, the final position writes to Firebase and becomes authoritative for all clients.
- **Remote client experience:** Object moves at ~12 FPS (80ms intervals) — smooth enough to clearly see movement.
- **Target latency:** <100ms end-to-end

### 7.3 Object Create / Edit / Delete

- **Create:** Single write to `boards/{boardId}/objects/{push()}` with full object data. Fires immediately.
- **Text edit:** Written to Firebase on blur or Enter. NOT on every keystroke (prevents write amplification and conflicts with edit lock).
- **Color/size changes:** Immediate single write on change.
- **Delete:** `remove()` on `boards/{boardId}/objects/{objectId}`. `onChildRemoved` fires on all clients.

### 7.4 Performance Targets

| Metric | Target | Implementation |
|--------|--------|---------------|
| Frame rate | 60 FPS during pan, zoom, object drag | Konva canvas rendering + React state batching. Avoid re-rendering all objects on cursor moves. |
| Object sync latency | <100ms | Direct Firebase SDK writes, no backend intermediary |
| Cursor sync latency | <50ms | Throttled at 30–50ms; Firebase propagation ~20ms |
| Object capacity | 500+ without performance drops | Konva layers. Viewport culling (render only visible objects) if needed post-MVP. |
| Concurrent users | 5+ without degradation | Firebase handles fan-out. Throttling prevents write amplification. |

---

## 8. Conflict Resolution

**Strategy:** Last-Write-Wins (Firebase default). The spec explicitly allows this.

### 8.1 Conflict Scenarios and UX Rules

| Scenario | System Behavior | User Experience |
|----------|----------------|-----------------|
| **Two users drag the same object** | Local authority during drag: each client ignores remote position updates for the object they're dragging. Last user to release writes the final position. | Each dragger sees their own smooth drag. Object settles at the last releaser's position. Remote observers see object jump between positions as throttled writes arrive — acceptable. |
| **Two users edit the same sticky text** | **Edit lock** via presence flag. When User A double-clicks a sticky, `editingObjectId` is set in their presence. Other clients check this flag before allowing edit mode. | Locked sticky shows a colored border matching User A's cursor color + "User A is editing..." tooltip. Double-clicking a locked sticky does nothing. Lock releases on blur, Enter, or disconnect. |
| **Two users create objects simultaneously** | No conflict. Each gets a unique Firebase push ID. Both objects appear for everyone. | Both objects appear. No issue. |
| **User A deletes while User B is editing** | Deletion wins (LWW). The object is removed from Firebase. User B's textarea overlay closes because the underlying object no longer exists in local state. | Editor sees object vanish. Acceptable trade-off for MVP. |
| **User A creates object while User B is offline** | User B receives the object on reconnect via Firebase listener replay. | User B's board catches up to current state. |

---

## 9. Presence & Disconnect Semantics

### 9.1 Connection Lifecycle

```
USER CONNECTS:
  1. Firebase Auth (anonymous or Google)
  2. Write: presence/{boardId}/{userId}/online = true
  3. Write: presence/{boardId}/{userId}/displayName = <name>
  4. Write: presence/{boardId}/{userId}/cursorColor = <assigned color>
  5. Register onDisconnect():
     - presence/{boardId}/{userId}/online = false
     - presence/{boardId}/{userId}/cursor = null
     - presence/{boardId}/{userId}/editingObjectId = null
  6. Subscribe to board objects: boards/{boardId}/objects/
  7. Subscribe to presence: presence/{boardId}/

USER MOVES MOUSE:
  - Throttled write (30-50ms): presence/{boardId}/{userId}/cursor = {x, y}

USER STARTS EDITING:
  - Write: presence/{boardId}/{userId}/editingObjectId = <objectId>
  - Other clients see lock, disable edit for that object

USER FINISHES EDITING:
  - Write: presence/{boardId}/{userId}/editingObjectId = null

USER DISCONNECTS (tab close, crash, network loss):
  - onDisconnect() fires server-side:
    → online = false
    → cursor = null
    → editingObjectId = null
  - Remote clients: remove cursor, update presence list, release edit locks

USER RECONNECTS (refresh or network recovery):
  1. Check .info/connected to detect reconnection
  2. Re-set online = true
  3. Re-register onDisconnect()
  4. Re-subscribe to board objects (Firebase replays current state)
  5. Guard against duplicate listeners (useRef flag or connection counter)
```

### 9.2 Ghost User Prevention

- **Primary:** `onDisconnect()` — fires server-side even if tab crashes
- **Secondary:** `lastSeen` timestamp updated every 60 seconds. Clients prune users with `lastSeen` > 2 minutes.
- **On reconnect:** Re-set `online = true` and re-register `onDisconnect()` to replace stale handlers.

### 9.3 Duplicate Listener Prevention

- Track connection state via `.info/connected`
- Use a `useRef` flag to prevent re-subscribing on React re-renders
- Call Firebase `off()` on component unmount to clean up listeners
- On reconnect, Firebase SDK handles listener replay — do NOT manually re-subscribe

---

## 10. Authentication

### 10.1 Auth Flow

```
User opens app → LoginPage

Option A (Primary): Anonymous Auth
  1. User enters display name
  2. Click "Continue as Guest"
  3. Firebase signInAnonymously()
  4. Store displayName in users/{uid}/
  5. Redirect to /board/:boardId (create new board or join via URL)

Option B (Secondary): Google Sign-In
  1. Click "Sign in with Google"
  2. Firebase signInWithPopup(GoogleAuthProvider)
  3. Store profile in users/{uid}/
  4. Redirect to /board/:boardId
```

### 10.2 Board Access

- Any authenticated user (anonymous or Google) can create a new board
- Boards are joinable via URL: `/board/:boardId`
- No invite system or permissions for MVP — anyone with the URL can join
- Board creator's userId stored as `ownerId` in board metadata

---

## 11. AI Board Agent

### 11.1 Architecture

```
Client (AICommandInput.tsx)
  │
  │  HTTPS POST { command: "Create a SWOT analysis", boardId: "abc123" }
  ▼
Firebase Cloud Function (ai-agent.ts)
  │
  ├─ 1. Read board state: getBoardState(boardId) → BoardObject[]
  ├─ 2. Call OpenAI GPT-4o with:
  │     - System prompt (role, context, board state)
  │     - User command
  │     - Tool schemas (9 functions)
  ├─ 3. Parse response: extract tool_calls[]
  ├─ 4. Execute each tool call sequentially:
  │     - createStickyNote → write to boards/{boardId}/objects/{push()}
  │     - moveObject → update boards/{boardId}/objects/{objectId}
  │     - etc.
  └─ 5. Return summary to client
  │
  ▼
All clients see results via existing Firebase real-time listeners
(No special AI event channel needed — AI writes go through the same DB paths)
```

### 11.2 Tool Schema

```typescript
// All 9 tools — minimum required by spec
interface AIToolSchema {
  createStickyNote(text: string, x: number, y: number, color: string): string;
  // Creates a sticky note. Returns objectId.

  createShape(type: "rectangle" | "circle" | "line", x: number, y: number, width: number, height: number, color: string): string;
  // Creates a shape. Returns objectId.

  createFrame(title: string, x: number, y: number, width: number, height: number): string;
  // Creates a named frame/container. Returns objectId.

  createConnector(fromId: string, toId: string, style: "arrow" | "line"): string;
  // Creates a line/arrow between two objects. Returns connectorId.

  moveObject(objectId: string, x: number, y: number): void;
  // Moves an object to new coordinates.

  resizeObject(objectId: string, width: number, height: number): void;
  // Resizes an object.

  updateText(objectId: string, newText: string): void;
  // Updates text content of a sticky note, text element, or frame title.

  changeColor(objectId: string, color: string): void;
  // Changes the fill color of an object.

  getBoardState(): BoardObject[];
  // Returns all current board objects for context. Max 100 most recently modified.
}
```

### 11.3 Supported Commands (11 Types, 4 Categories)

**Creation Commands:**

| Command Example | Tools Called |
|----------------|-------------|
| "Add a yellow sticky note that says 'User Research'" | `createStickyNote("User Research", auto_x, auto_y, "#FBBF24")` |
| "Create a blue rectangle at position 100, 200" | `createShape("rectangle", 100, 200, 200, 150, "#3B82F6")` |
| "Add a frame called 'Sprint Planning'" | `createFrame("Sprint Planning", auto_x, auto_y, 600, 400)` |

**Manipulation Commands:**

| Command Example | Tools Called |
|----------------|-------------|
| "Move all the pink sticky notes to the right side" | `getBoardState()` → filter by color → `moveObject(id, x, y)` for each |
| "Change the sticky note color to green" | `getBoardState()` → identify target → `changeColor(id, "#22C55E")` |
| "Resize the frame to fit its contents" | `getBoardState()` → calculate bounding box → `resizeObject(id, w, h)` |

**Layout Commands:**

| Command Example | Tools Called |
|----------------|-------------|
| "Arrange these sticky notes in a grid" | `getBoardState()` → calculate grid positions → `moveObject(id, x, y)` for each |
| "Space these elements evenly" | `getBoardState()` → calculate even spacing → `moveObject(id, x, y)` for each |

**Complex / Multi-Step Commands:**

| Command Example | Tools Called |
|----------------|-------------|
| "Create a SWOT analysis template" | `createFrame()` ×4 (Strengths, Weaknesses, Opportunities, Threats as quadrants) + `createStickyNote()` ×4 (one label per quadrant) |
| "Build a user journey map with 5 stages" | `createFrame()` ×5 + `createStickyNote()` ×5 + `createConnector()` ×4 |
| "Set up a retrospective board" | `createFrame()` ×3 (What Went Well, What Didn't, Action Items) + `createStickyNote()` ×3 placeholder notes |

**Total: 11 command types across 4 categories.** Exceeds the minimum of 6.

### 11.4 AI Agent Concurrency

- Multiple users can issue AI commands simultaneously. AI writes go through the same Firebase RTDB paths as manual writes. Conflicts resolve via the same LWW rule.
- No per-board mutex. Commands from different users are independent.
- Rate limiting: max 10 AI commands per user per minute, enforced in the Cloud Function.

### 11.5 AI Agent Performance Targets

| Metric | Target |
|--------|--------|
| Response latency | <2 seconds for single-step commands |
| Command breadth | 11 command types (exceeds minimum of 6) |
| Complexity | Multi-step execution (SWOT = 8 tool calls in one response) |
| Reliability | Strict tool schemas with input validation; retry once on parse failure |
| Shared state | All users see AI results in real-time via existing Firebase listeners |

### 11.6 System Prompt (Cloud Function)

```
You are an AI assistant that manipulates a collaborative whiteboard. You have access to
tools for creating and manipulating board objects.

Current board state is provided as context. Use it to understand existing objects when
the user references them (e.g., "move the pink stickies" or "resize the frame").

For complex commands (SWOT analysis, retro board, journey map), plan your tool calls
to create a well-organized layout. Use consistent spacing (e.g., 220px between objects,
300px between frames).

When placing new objects, avoid overlapping existing objects. Use the board state to
find open space.

Available colors: yellow (#FBBF24), pink (#F472B6), blue (#3B82F6), green (#22C55E),
orange (#F97316), purple (#A855F7), red (#EF4444), gray (#9CA3AF), white (#FFFFFF).

Always respond with tool calls. Do not respond with text-only messages.
```

---

## 12. Firebase Security Rules

```json
{
  "rules": {
    "boards": {
      "$boardId": {
        "metadata": {
          ".read": "auth != null",
          ".write": "auth != null && (!data.exists() || data.child('ownerId').val() === auth.uid)"
        },
        "objects": {
          ".read": "auth != null",
          "$objectId": {
            ".write": "auth != null"
          }
        },
        "connectors": {
          ".read": "auth != null",
          "$connectorId": {
            ".write": "auth != null"
          }
        }
      }
    },
    "presence": {
      "$boardId": {
        ".read": "auth != null",
        "$userId": {
          ".write": "auth != null && $userId === auth.uid"
        }
      }
    },
    "users": {
      "$userId": {
        ".read": "auth != null",
        ".write": "auth != null && $userId === auth.uid"
      }
    }
  }
}
```

**Key rules:**
- All reads require authentication
- Users can only write to their own presence path
- Any authenticated user can create/modify board objects (for MVP; tighten post-MVP)
- Board metadata can only be created or modified by the board owner

---

## 13. Evaluator Test Plan

These are the 5 exact scenarios that will be tested during evaluation. Each has defined pass criteria.

### Test 1: Two Users Editing Simultaneously

**Setup:** Two browser windows, both authenticated, same board.
**Actions:** User A creates a sticky note. User B creates a shape. Both drag objects simultaneously.
**Pass criteria:**
- Both objects appear on both screens within <100ms
- Simultaneous drags do not interfere (no jitter, no dropped objects)
- Both final positions correct on both screens

### Test 2: One User Refreshing Mid-Edit

**Setup:** User A editing a sticky note's text. User B observing.
**Actions:** User A is mid-typing, hits F5.
**Pass criteria:**
- Text committed before refresh is preserved
- After refresh, User A sees full board state including User B's objects
- User A reappears in presence list after reconnection
- No duplicate objects or ghost state

### Test 3: Rapid Creation and Movement

**Setup:** Single user creating objects rapidly.
**Actions:** Create 20+ sticky notes in quick succession. Drag multiple objects rapidly.
**Pass criteria:**
- All objects appear on remote clients
- No dropped creates (every object persists)
- Canvas maintains 60 FPS
- No visible lag during rapid drag

### Test 4: Network Throttling and Disconnection Recovery

**Setup:** Two browsers. Apply Chrome DevTools network throttle (Slow 3G) to one, then go offline, then reconnect.
**Actions:** Throttle User A → User A creates/moves objects → User A goes offline → User B makes changes → User A reconnects.
**Pass criteria:**
- User A's pre-disconnect changes persist
- On reconnect, User A receives User B's changes
- User A's presence goes offline within seconds of disconnect
- User A's presence returns on reconnect
- No ghost cursors for disconnected users
- No duplicate listeners on reconnect

### Test 5: 5+ Concurrent Users Without Degradation

**Setup:** 5+ browser windows/tabs, unique display names, same board.
**Pass criteria:**
- All 5+ cursors visible with correct name labels
- Object creation by any user appears on all screens
- Presence list shows all 5+ users
- Canvas stays at 60 FPS
- Cursor sync <50ms
- No noticeable degradation vs 2-user scenario

---

## 14. Build Priority Order

Follows spec-recommended approach: validate real-time sync first, then layer features.

| Phase | Task | Time | Milestone |
|-------|------|------|-----------|
| 1 | Firebase project setup + Auth (Anonymous + Google) + routing (`/`, `/board/:boardId`) | 2h | Can authenticate and navigate to board URL |
| 2 | **Cursor sync** — two browsers, cursors moving across screens (in a blank div first, then Konva) | 3h | **Hardest technical risk validated** |
| 3 | Presence system — online user list, `onDisconnect()`, reconnect handling, ghost user prevention | 2h | Who's online works correctly |
| 4 | Konva canvas — infinite board with smooth pan/zoom | 2h | 60 FPS canvas with viewport |
| 5 | Sticky notes — create, move (throttled drag sync), edit text (textarea overlay + edit lock) | 4h | Core object CRUD with real-time sync |
| 6 | Rectangle shape + single selection + delete (backspace key) | 2h | **MVP GATE COMPLETE (~15h)** |
| 7 | Deploy to Vercel + Firebase Blaze | 1h | Publicly accessible URL |
| — | **MVP DEADLINE (24 hours)** | — | — |
| 8 | Additional shapes (circle, line) + connectors + frames | 4h | Full object type support |
| 9 | Multi-select (shift-click, drag-to-select) + resize handles + duplicate + copy/paste | 4h | Polish |
| 10 | AI agent — Cloud Function + OpenAI + basic commands (create, move, change color) | 4h | Single-step AI working |
| 11 | AI agent — complex commands (SWOT, retro, journey map) + getBoardState context | 4h | Multi-step AI working |
| 12 | Integration tests (Vitest + Firebase Emulator) + 5-user stress test + performance tuning | 3h | All 5 evaluator test scenarios pass |
| 13 | Documentation, demo video (3–5 min), cost analysis, social post | 3h | **FINAL SUBMISSION** |

**Buffer:** ~9 hours slack across the 7-day sprint for unexpected issues.

**Critical rule:** Test with two browser windows side-by-side at all times during development. Every feature must be verified as multiplayer-correct before moving to the next phase.

---

## 15. TypeScript Types

```typescript
// ─── Board Objects ─────────────────────────────────────────────

type ObjectType = "sticky" | "rectangle" | "circle" | "line" | "frame" | "text";

interface BoardObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text?: string;
  rotation: number;
  zIndex: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface Connector {
  id: string;
  fromId: string;
  toId: string;
  style: "arrow" | "line";
  points?: number[];
}

interface BoardMetadata {
  title: string;
  createdAt: number;
  ownerId: string;
}

// ─── Presence ──────────────────────────────────────────────────

interface CursorPosition {
  x: number;
  y: number;
}

interface UserPresence {
  displayName: string;
  cursorColor: string;
  cursor: CursorPosition | null;
  online: boolean;
  lastSeen: number;
  editingObjectId: string | null;
}

// ─── Auth ──────────────────────────────────────────────────────

interface UserProfile {
  displayName: string;
  email: string | null;
  photoURL: string | null;
  authMethod: "anonymous" | "google";
}

// ─── AI Agent ──────────────────────────────────────────────────

interface AICommand {
  command: string;
  boardId: string;
  userId: string;
}

interface AIResponse {
  success: boolean;
  message: string;
  objectsCreated: string[];  // IDs of created objects
  objectsModified: string[]; // IDs of modified objects
  error?: string;
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

// ─── Canvas ────────────────────────────────────────────────────

interface ViewportState {
  x: number;       // pan offset x
  y: number;       // pan offset y
  scale: number;   // zoom level (0.1 to 4.0)
}

// ─── Component Props ───────────────────────────────────────────

interface StickyNoteProps {
  object: BoardObject;
  isSelected: boolean;
  isLockedByOther: boolean;
  lockedByName?: string;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDoubleClick: (id: string) => void;
}

interface RemoteCursorProps {
  displayName: string;
  color: string;
  x: number;
  y: number;
}
```

---

## 16. Color Palette

```typescript
const STICKY_COLORS = {
  yellow: "#FBBF24",
  pink: "#F472B6",
  blue: "#3B82F6",
  green: "#22C55E",
  orange: "#F97316",
  purple: "#A855F7",
} as const;

const SHAPE_COLORS = {
  red: "#EF4444",
  blue: "#3B82F6",
  green: "#22C55E",
  yellow: "#FBBF24",
  gray: "#9CA3AF",
  black: "#1F2937",
} as const;

const CURSOR_COLORS = [
  "#EF4444", // red
  "#3B82F6", // blue
  "#22C55E", // green
  "#F97316", // orange
  "#A855F7", // purple
  "#EC4899", // pink
  "#14B8A6", // teal
  "#F59E0B", // amber
];
// Assigned round-robin on join. Index = user count % array length.
```

---

## 17. Key Hook Specifications

### useBoard(boardId: string)

```typescript
interface UseBoardReturn {
  objects: Record<string, BoardObject>;
  connectors: Record<string, Connector>;
  createObject: (obj: Omit<BoardObject, "id" | "createdAt" | "updatedAt">) => string;
  updateObject: (id: string, updates: Partial<BoardObject>) => void;
  deleteObject: (id: string) => void;
  createConnector: (conn: Omit<Connector, "id">) => string;
  deleteConnector: (id: string) => void;
  loading: boolean;
}
```

- Subscribes to `boards/{boardId}/objects/` and `boards/{boardId}/connectors/` on mount
- Unsubscribes (`off()`) on unmount
- Uses `useRef` to prevent duplicate subscriptions
- `createObject` generates Firebase push ID, writes full object, returns ID
- `updateObject` writes partial update to `boards/{boardId}/objects/{id}`
- All writes include `updatedAt: serverTimestamp()`

### usePresence(boardId: string, userId: string)

```typescript
interface UsePresenceReturn {
  users: Record<string, UserPresence>;
  updateCursor: (x: number, y: number) => void;  // throttled
  setEditingObject: (objectId: string | null) => void;
  isObjectLocked: (objectId: string) => { locked: boolean; lockedBy?: string };
}
```

- On mount: set `online = true`, register `onDisconnect()`, subscribe to `presence/{boardId}/`
- `updateCursor`: throttled to 30–50ms, writes to `presence/{boardId}/{userId}/cursor`
- `setEditingObject`: writes `editingObjectId` to presence
- `isObjectLocked`: checks all presence entries for matching `editingObjectId`
- On unmount: set `online = false`, unsubscribe

### useCanvas()

```typescript
interface UseCanvasReturn {
  viewport: ViewportState;
  onWheel: (e: KonvaEventObject<WheelEvent>) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
  stageRef: React.RefObject<Konva.Stage>;
  screenToCanvas: (screenX: number, screenY: number) => { x: number; y: number };
}
```

- Manages pan/zoom viewport state
- `onWheel`: zoom toward cursor position (scale *= 1.05 or /= 1.05)
- `screenToCanvas`: converts screen coordinates to canvas coordinates (needed for textarea overlay positioning)
- Zoom range: 0.1 to 4.0

### useAIAgent(boardId: string)

```typescript
interface UseAIAgentReturn {
  sendCommand: (command: string) => Promise<AIResponse>;
  isProcessing: boolean;
  lastResponse: AIResponse | null;
  error: string | null;
}
```

- `sendCommand`: calls Firebase Cloud Function with `{ command, boardId, userId }`
- Sets `isProcessing = true` while waiting
- Results appear automatically via existing board listeners (AI writes to same DB paths)
- Error handling: timeout after 30 seconds, display error message

---

## 18. Text Editing on Canvas (Critical Implementation Detail)

Konva canvas does not support native text input. The standard pattern is an HTML overlay:

```
1. User double-clicks a sticky note (or text element)
2. Check edit lock: if another user is editing this object, show tooltip and abort
3. Set editingObjectId in presence (acquire lock)
4. Calculate the textarea position:
   - Get the object's canvas coordinates (x, y)
   - Apply the Stage transform (pan offset + zoom scale)
   - Convert to screen coordinates using stage.getAbsoluteTransform()
5. Mount an absolutely-positioned HTML <textarea> at those screen coordinates
   - Match the object's width, height, font size, color
   - Set z-index above the canvas
   - Auto-focus the textarea
6. User types freely (local state only, no Firebase writes per keystroke)
7. On blur or Enter:
   - Read textarea value
   - Write to Firebase: updateObject(id, { text: value })
   - Clear editingObjectId in presence (release lock)
   - Unmount the textarea
```

**Gotcha:** When the user pans or zooms while a textarea is open, you must either close the textarea or reposition it. Simplest approach for MVP: close the textarea on any pan/zoom and commit current text.

---

## 19. Submission Deliverables Checklist

| Deliverable | Status | Notes |
|-------------|--------|-------|
| GitHub Repository | ☐ | Setup guide, architecture overview, deployed link in README |
| Demo Video (3–5 min) | ☐ | Show: real-time collab, AI commands, architecture explanation |
| Pre-Search Document | ☐ | Completed checklist from Phase 1–3 (see Pre-Search doc) |
| AI Development Log | ☐ | 1-page: tools used, effective prompts, code analysis, learnings |
| AI Cost Analysis | ☐ | Dev spend + projections for 100/1K/10K/100K users |
| Deployed Application | ☐ | Public URL, supports 5+ users with auth |
| Social Post | ☐ | X or LinkedIn: description, features, demo/screenshots, tag @GauntletAI |

---

## 20. AI-First Development Workflow

### Tools Committed

| Tool | Role | Usage |
|------|------|-------|
| **Claude Code** | Primary coding agent | Feature scaffolding, generating full components/hooks, Firebase service layers, refactoring, test suites |
| **Cursor** | In-editor AI assistant | Inline autocomplete, quick edits, debugging, tab-completion for boilerplate |
| **pi-coding-agent** | Secondary coding agent | Alternative implementations, code review, architecture validation |

### Development Log Tracking

Throughout the sprint, track:
- Which tool was used for each major feature
- 3–5 effective prompts (exact text) that produced good results
- Rough % of AI-generated vs hand-written code
- Where AI excelled (boilerplate, service layers, type definitions)
- Where AI struggled (real-time sync edge cases, canvas coordinate transforms)

### AI Cost Tracking

Log from day one:
- OpenAI API calls (count, input tokens, output tokens, cost)
- Any other LLM API costs
- Firebase usage (reads/writes/connections)

Production cost projections needed for: 100 / 1,000 / 10,000 / 100,000 users.
