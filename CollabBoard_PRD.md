# CollabBoard — Pre-Search Document

**Project:** CollabBoard — Real-Time Collaborative Whiteboard with AI Agent  
**Author:** [Your Name]  
**Date:** February 16, 2026  
**Sprint Duration:** 1 week (MVP due in 24 hours)

---

## Phase 1: Define Your Constraints

### 1. Scale & Load Profile

- **Users at launch:** 5–10 (evaluation/demo context)
- **Users at 6 months:** 50–100 (if extended beyond course project)
- **Traffic pattern:** Spiky — multiple evaluators testing simultaneously during review windows, otherwise idle
- **Real-time requirements:** Yes — WebSocket-level real-time for cursor sync (<50ms), object sync (<100ms), and presence awareness
- **Cold start tolerance:** Low — board must load quickly for evaluators. Firebase Realtime DB has no cold start penalty (persistent connections)

**Decision:** Design for 5–10 concurrent users per board with the architecture capable of supporting 50+. Firebase Realtime DB handles this natively without scaling configuration.

### 2. Budget & Cost Ceiling

- **Monthly spend limit:** <$50/month for development and demo usage
- **Pay-per-use acceptable:** Yes — Firebase Spark (free tier) covers development; Blaze (pay-as-you-go) for production
- **Trade money for time:** Strongly prefer managed services (Firebase) over self-hosted infrastructure to maximize development speed

**Decision:** Firebase free tier for development. Blaze plan for production deployment. OpenAI API costs estimated at <$5/month for demo-level AI agent usage.

### 3. Time to Ship

- **MVP timeline:** 24 hours (hard gate)
- **Priority:** Speed-to-market over long-term maintainability
- **Iteration cadence:** Daily — Pre-Search → MVP (Day 1) → Early Submission (Day 4) → Final (Day 7)

**Decision:** Prioritize vertical slices. Validate real-time sync first (cursor sync in a blank page), then layer canvas and features on top. No premature optimization.

### 4. Compliance & Regulatory Needs

- **HIPAA:** No
- **GDPR:** No — US-only demo project
- **SOC 2:** No
- **Data residency:** No requirements

**Decision:** No compliance overhead. Standard Firebase security rules sufficient.

### 5. Team & Skill Constraints

- **Team size:** Solo developer
- **Known stack:** React, TypeScript, Tailwind CSS, Firebase, AWS
- **AI tools available:** Claude Code + Cursor + pi-coding-agent (development), GPT-4o (AI agent feature)
- **Preference:** Ship fast using AI-assisted development throughout

**Decision:** Lean heavily on AI coding tools. Use the most well-documented stack to maximize AI code generation quality.

---

## Phase 2: Architecture Discovery

### 6. Hosting & Deployment

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Vercel | Instant deploys, great Vite support, preview URLs | Need separate Firebase for backend | ✅ Selected |
| Firebase Hosting | All-in-one with Firebase | Slightly more config for Vite apps | Runner-up |
| Render | Full-stack support | Slower deploys, cold starts on free tier | Rejected |

- **CI/CD:** Vercel auto-deploys from GitHub `main` branch
- **Scaling:** Vercel handles frontend scaling; Firebase handles data scaling
- **Cloud Functions:** Firebase Cloud Functions for AI agent endpoint (keeps OpenAI API key server-side)

**Decision:** Vercel for frontend hosting. Firebase Cloud Functions for the AI agent backend endpoint.

### 7. Authentication & Authorization

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Anonymous + Google (Firebase Auth) | Zero friction for evaluators; real identity available | Guest users lose state on cookie clear | ✅ Selected |
| Google sign-in only | Simplest, real identities | Blocks evaluators who don't want to use personal Google accounts | Rejected |
| Clerk | Polished UI, great DX | Additional dependency, cost at scale | Rejected |

- **Primary flow:** Anonymous Auth — user clicks "Continue as Guest," enters a display name, immediately lands on a board. No account creation friction.
- **Secondary flow:** Google sign-in for persistent identity (optional).
- **RBAC:** Not needed for MVP — all authenticated users can access all boards.
- **Multi-tenancy:** Boards are isolated by boardId; users can create/join boards via shareable URL.

**Decision:** Firebase Auth with Anonymous Auth as primary (evaluator-friendly) and Google sign-in as optional. Display name prompt on anonymous entry for cursor labels and presence.

### 8. Database & Data Layer

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| Firebase Realtime DB | Built-in real-time listeners, optimized for frequent small writes, presence system | Less querying power, 1MB download limit per read | ✅ Selected |
| Firestore | Better querying, offline support | Higher latency for real-time cursor sync, more expensive per write | Rejected |
| Supabase (Postgres) | SQL power, Realtime channels | Additional service, Realtime is newer/less proven | Rejected |

**Database Schema:**

```
boards/
  {boardId}/
    metadata/          → title, createdAt, ownerId
    objects/
      {objectId}/      → type, x, y, width, height, color, text, rotation, zIndex
    connectors/
      {connectorId}/   → fromId, toId, style, points

presence/
  {boardId}/
    {userId}/          → displayName, cursorColor, cursor: {x, y},
                         lastSeen, online, editingObjectId (null or objectId)

users/
  {userId}/            → displayName, email, photoURL, authMethod
```

- **Conflict resolution:** Last-write-wins (Firebase's default). See Section "Conflict Handling & UX Rules" below for behavioral details.
- **Persistence:** Firebase Realtime DB persists all data automatically — board state survives all users leaving and returning.
- **Presence path is separate** from board objects to isolate high-frequency cursor writes from object data.

**Decision:** Firebase Realtime DB as the single data layer. Flat, denormalized schema. Separate `presence/` path for cursors and online status.

### 9. Backend/API Architecture

- **Architecture:** No traditional backend. Firebase Realtime DB + Firebase Cloud Functions (serverless).
- **API surface:**
  - Client ↔ Firebase Realtime DB: direct reads/writes via SDK (objects, presence, cursors)
  - Client → Firebase Cloud Function: AI agent commands (natural language → OpenAI → Firebase writes)
- **Background jobs:** None needed for MVP.

**Decision:** Serverless architecture. The only "backend" is a single Firebase Cloud Function that handles AI agent requests.

### 10. Frontend Framework & Rendering

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | React 18+ with Vite | Fast build, excellent ecosystem, best AI code generation support |
| Styling | Tailwind CSS | Utility-first, fast prototyping |
| Canvas | Konva.js via react-konva | Declarative canvas rendering that maps cleanly to React's component model |
| Routing | TanStack Router | Type-safe routing (board URLs: `/board/:boardId`) |
| Language | TypeScript (strict mode) | Catches real-time sync bugs at compile time |

- **Text editing on canvas:** Double-click a sticky note → mount an HTML `<textarea>` overlay positioned at the object's transformed canvas coordinates → update local state while typing → commit to Firebase on blur/Enter. This is the standard Konva pattern for editable text.
- **SEO:** Not needed — app is behind auth.
- **SPA vs SSR:** SPA — no server-side rendering needed.

**Decision:** React + Vite + Tailwind + react-konva + TypeScript strict. TanStack Router for navigation.

### 11. Third-Party Integrations

| Service | Purpose | Cost | Risk |
|---------|---------|------|------|
| Firebase (Realtime DB, Auth, Cloud Functions) | Core infrastructure | Free tier → Blaze pay-as-you-go | Vendor lock-in (acceptable for this project) |
| OpenAI GPT-4o API | AI board agent | ~$0.001–0.003 per command | Rate limits; mitigated by per-user throttling |
| Vercel | Frontend hosting | Free tier | None |

**Decision:** Three external services total. All have generous free tiers. OpenAI API key stored in Firebase Cloud Function environment config, never exposed to client.

---

## Phase 3: Post-Stack Refinement

### 12. Security Vulnerabilities

**Firebase-specific risks:**

- **Open security rules:** Default Firebase rules allow all reads/writes. Must be locked down before deployment.
- **Recommended rules:**
  - Users can only write to their own presence path (`presence/{boardId}/{userId}` where `userId` matches `auth.uid`)
  - Users can only create/modify objects on boards they have access to
  - Board metadata is read-only except for the owner
- **API key exposure:** OpenAI API key must live exclusively in Firebase Cloud Function environment variables
- **Rate limiting:** Per-user rate limiting on AI commands in the Cloud Function (max 10 commands/minute per user)
- **Input sanitization:** Validate AI command input length and content before sending to OpenAI

**Dependency risks:**

- `react-konva` is actively maintained but has fewer contributors than Fabric.js — acceptable for a 1-week project
- Firebase SDK is Google-maintained — low risk

### 13. File Structure & Project Organization

```
collabboard/
├── src/
│   ├── components/
│   │   ├── canvas/          # Board, StickyNote, Shape, Connector, Frame, Cursor
│   │   ├── toolbar/         # ToolBar, ShapeSelector, ColorPicker
│   │   ├── sidebar/         # PresencePanel, AICommandInput
│   │   ├── auth/            # LoginPage, AuthProvider
│   │   └── ui/              # Shared UI components
│   ├── hooks/
│   │   ├── useBoard.ts      # Board object CRUD + Firebase sync
│   │   ├── usePresence.ts   # Online users + cursor positions
│   │   ├── useCursors.ts    # Throttled cursor broadcasting
│   │   ├── useAIAgent.ts    # AI command submission + response handling
│   │   ├── useCanvas.ts     # Pan, zoom, viewport state
│   │   └── useSelection.ts  # Object selection state
│   ├── services/
│   │   ├── firebase.ts      # Firebase app initialization + exports
│   │   ├── board.ts         # Firebase Realtime DB operations for board objects
│   │   ├── presence.ts      # Presence system operations + onDisconnect handlers
│   │   └── ai-agent.ts      # Cloud Function client calls
│   ├── types/
│   │   ├── board.ts         # BoardObject, StickyNote, Shape, Connector, Frame
│   │   ├── presence.ts      # UserPresence, CursorPosition
│   │   └── ai.ts            # AICommand, AIResponse, ToolSchema
│   ├── utils/
│   │   ├── colors.ts        # Color palettes and helpers
│   │   ├── geometry.ts      # Position, size, intersection calculations
│   │   └── throttle.ts      # Cursor + drag update throttling
│   ├── App.tsx
│   ├── main.tsx
│   └── router.tsx
├── functions/
│   ├── src/
│   │   ├── index.ts         # Cloud Function entry point
│   │   ├── ai-agent.ts      # OpenAI integration + tool execution
│   │   └── tools.ts         # Tool schemas + Firebase write functions
│   ├── package.json
│   └── tsconfig.json
├── public/
├── firebase.json
├── .firebaserc
├── firestore.rules
├── database.rules.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── package.json
└── README.md
```

**Decision:** Simple monorepo. All frontend code in `src/`. Cloud Functions in `functions/`. No workspace tooling overhead.

### 14. Naming Conventions & Code Style

| Element | Convention | Example |
|---------|-----------|---------|
| Components | PascalCase `.tsx` | `StickyNote.tsx`, `PresencePanel.tsx` |
| Hooks | `use` prefix, camelCase `.ts` | `useBoard.ts`, `usePresence.ts` |
| Services | camelCase `.ts` | `firebase.ts`, `ai-agent.ts` |
| Types/Interfaces | PascalCase (no `I` prefix) | `BoardObject`, `UserPresence` |
| Firebase paths | camelCase | `boards/{boardId}/objects/{objectId}` |
| Constants | UPPER_SNAKE_CASE | `MAX_CURSOR_UPDATE_RATE`, `DEFAULT_COLORS` |

- **Linter:** ESLint with `@typescript-eslint` + React plugin
- **Formatter:** Prettier (2-space indent, single quotes, trailing commas)
- **Strict mode:** `tsconfig.json` with `"strict": true`

### 15. Testing Strategy

| Level | Tool | Scope | Priority |
|-------|------|-------|----------|
| Unit | Vitest | AI agent tool functions, geometry utils, throttle logic | High |
| Integration | Vitest + Firebase Emulator | Board CRUD, presence sync, conflict handling, disconnect/reconnect | High |
| Manual | Multiple browser windows | All 5 evaluator test scenarios (see Evaluator Test Plan below) | Critical |
| E2E | None for MVP | Would use Playwright post-MVP | Deferred |

- **Firebase Emulator:** Use for local development to avoid quota consumption and enable repeatable integration tests
- **Manual testing protocol:** Two Chrome windows side-by-side at all times during development

### 16. Recommended Tooling & DX

**VS Code / Cursor Extensions:**

- ES7+ React/Redux/React-Native snippets
- Tailwind CSS IntelliSense
- Firebase Explorer
- Prettier - Code Formatter
- ESLint

**CLI Tools:**

- Firebase CLI (`firebase emulators:start`, `firebase deploy`)
- Vercel CLI (`vercel --prod`)

**Debugging:**

- Chrome DevTools (Network tab for throttling, Application tab for Firebase)
- Firebase Emulator UI (inspect database state in real-time)
- React DevTools (component state inspection)

---

## MVP Gate Traceability (Hard Requirements)

Every item below must pass to clear the 24-hour gate. No partial credit.

| # | Requirement | Implementation | Verification |
|---|------------|----------------|--------------|
| 1 | Infinite board with pan/zoom | Konva `Stage` with `draggable={true}` + `onWheel` zoom handler. Viewport state tracked in `useCanvas` hook. | Open board → drag canvas to pan → scroll to zoom in/out. Canvas moves smoothly at 60 FPS. |
| 2 | Sticky notes with editable text | `StickyNote` component renders Konva `Rect` + `Text`. Double-click mounts HTML `<textarea>` overlay at transformed coords. Commit on blur/Enter. | Create sticky → double-click → type text → click away → text persists. Refresh → text still there. |
| 3 | At least one shape type | `Shape` component supporting rectangles (Konva `Rect`). Circles and lines added post-MVP. | Select rectangle tool → click canvas → rectangle appears with default size/color. |
| 4 | Create, move, and edit objects | Create via toolbar click or canvas click. Move via Konva `draggable`. Edit via double-click (text) or property panel (color, size). | Create sticky → drag it → edit text → all changes persist across refresh. |
| 5 | Real-time sync between 2+ users | Firebase Realtime DB listeners on `boards/{boardId}/objects/`. `onChildAdded`, `onChildChanged`, `onChildRemoved` update local state. | Browser A creates sticky → Browser B sees it appear within <100ms. Browser B moves it → Browser A sees movement. |
| 6 | Multiplayer cursors with name labels | Each user writes throttled cursor position to `presence/{boardId}/{userId}/cursor`. All clients listen to `presence/{boardId}/` and render remote cursors. | Browser A moves mouse → Browser B sees labeled cursor following within <50ms. |
| 7 | Presence awareness (who's online) | `presence/{boardId}/{userId}/online` set to `true` on connect, `false` via `onDisconnect()`. UI shows online user list with colored dots. | Browser A joins → Browser B sees "User A" in presence list. Browser A closes tab → Browser B sees User A disappear within seconds. |
| 8 | User authentication | Firebase Auth: Anonymous Auth with display name prompt as primary. Google sign-in as optional. `AuthProvider` wraps app, redirects unauthenticated users to login. | Open app → enter display name → "Continue as Guest" → land on board. Alternatively sign in with Google. |
| 9 | Deployed and publicly accessible | Frontend on Vercel (auto-deploy from GitHub). Firebase Realtime DB + Auth + Cloud Functions on Firebase Blaze. | Share URL → anyone with link can authenticate and join the board. |

---

## Evaluator Test Plan

These are the 5 exact scenarios the spec says will be tested. Each has a defined pass condition.

### Test 1: Two users editing simultaneously in different browsers

**Setup:** Two browser windows, both authenticated, both on the same board.

**Actions:** User A creates a sticky note. User B creates a shape. Both drag objects simultaneously.

**Pass criteria:**
- Both objects appear on both screens within <100ms
- Simultaneous drags do not interfere with each other (no jitter, no dropped objects)
- Both final positions are correct on both screens

### Test 2: One user refreshing mid-edit

**Setup:** User A is editing a sticky note's text. User B is observing.

**Actions:** User A is mid-typing, hits F5 to refresh the page.

**Pass criteria:**
- Text committed before refresh is preserved (text saved on each keystroke or on blur, so partial text since last commit may be lost — this is acceptable and documented)
- After refresh, User A sees the full board state including User B's objects
- User A reappears in the presence list after reconnection
- No duplicate objects or ghost state

### Test 3: Rapid creation and movement of sticky notes and shapes

**Setup:** Single user creating objects rapidly.

**Actions:** Create 20+ sticky notes in quick succession. Drag multiple objects rapidly.

**Pass criteria:**
- All objects appear on remote clients
- No dropped creates (every object persists)
- Canvas maintains 60 FPS during rapid interaction
- No visible lag or stutter during rapid drag

### Test 4: Network throttling and disconnection recovery

**Setup:** Two browsers. One applies network throttle via Chrome DevTools (Slow 3G) then goes offline then back online.

**Actions:** Throttle User A's network. User A creates/moves objects. User A goes offline. User B makes changes. User A reconnects.

**Pass criteria:**
- User A's changes made before disconnect are persisted to DB
- On reconnect, User A receives User B's changes (board rehydrates from server state)
- User A's presence goes offline within seconds of disconnect (via `onDisconnect()`)
- User A's presence returns to online on reconnect
- No ghost cursors remain for disconnected users
- No duplicate listeners (connection state handler prevents stacking)

### Test 5: 5+ concurrent users without degradation

**Setup:** 5+ browser windows (can be tabs), all authenticated with unique display names, all on the same board.

**Pass criteria:**
- All 5+ cursors visible with correct name labels
- Object creation by any user appears on all other screens
- Presence list shows all 5+ users
- Canvas remains at 60 FPS
- Cursor sync latency remains <50ms
- No noticeable performance degradation compared to 2-user scenario

---

## Realtime Data Flow & Throttling Rules

### Cursor Updates

- **Throttle interval:** 30–50ms (20–33 updates/second per user)
- **Path:** `presence/{boardId}/{userId}/cursor` → `{x, y}`
- **Listener:** All clients subscribe to `presence/{boardId}/` with `onValue` or `onChildChanged`
- **Rendering:** Remote cursors rendered as lightweight Konva elements (colored arrow + name label) outside the main object layer

### Object Drag Updates

- **Strategy:** Throttled writes every ~80ms while dragging + final write on drag end
- **Path:** `boards/{boardId}/objects/{objectId}` → update `x, y` fields
- **Local authority rule:** While User A is dragging object X, User A's client ignores remote updates for object X's position. This prevents jitter from round-trip lag. On drag end, the final position is written to Firebase and becomes authoritative.
- **Remote clients:** See the object moving smoothly at ~12 FPS (80ms intervals). Acceptable for "watching someone else drag."

### Object Create / Edit

- **Create:** Single write to `boards/{boardId}/objects/{newObjectId}` with full object data. Immediate.
- **Text edit:** Written to Firebase on blur or Enter. Not on every keystroke (would be too many writes and would conflict with the edit lock).
- **Color/size changes:** Immediate single write on change.

### Performance Budget

| Metric | Target | How Achieved |
|--------|--------|--------------|
| 60 FPS during pan/zoom/drag | Konva's canvas rendering + React state batching | Avoid re-rendering entire object list on cursor moves |
| Object sync <100ms | Firebase RTDB listener latency is typically 20–50ms | Direct SDK writes, no backend intermediary |
| Cursor sync <50ms | Throttled at 30–50ms; Firebase propagation adds ~20ms | Separate presence listener path, lightweight cursor components |
| 500+ objects | Konva layers + viewport culling (only render visible objects) | Implement culling post-MVP if needed |
| 5+ users | Firebase handles fan-out natively | Throttling prevents write amplification |

---

## Presence & Disconnect Semantics

### Connection Lifecycle

```
User opens app
  → Firebase Auth (anonymous or Google)
  → Set presence/{boardId}/{userId}/online = true
  → Set presence/{boardId}/{userId}/displayName, cursorColor
  → Register onDisconnect(): set online = false, remove cursor

User moves mouse
  → Throttled write to presence/{boardId}/{userId}/cursor = {x, y}

User starts editing a sticky note
  → Set presence/{boardId}/{userId}/editingObjectId = objectId
  → Other clients see the lock and disable edit mode for that object

User finishes editing
  → Set presence/{boardId}/{userId}/editingObjectId = null

User closes tab / loses connection
  → onDisconnect() fires:
    → presence/{boardId}/{userId}/online = false
    → presence/{boardId}/{userId}/cursor = null
    → presence/{boardId}/{userId}/editingObjectId = null
  → Remote clients remove cursor, update presence list, release any edit locks

User reconnects (refresh or network recovery)
  → Check .info/connected to detect reconnection
  → Re-set online = true, re-register onDisconnect()
  → Re-subscribe to board objects (Firebase SDK handles this, but guard against duplicate listeners)
  → Board state rehydrates from server (Firebase SDK replays current state on new listener)
```

### Ghost User Prevention

- `onDisconnect()` is the primary mechanism. It fires server-side, so it works even if the tab crashes.
- `lastSeen` timestamp updated every 60 seconds as a backup. Clients can prune users with `lastSeen` older than 2 minutes as a secondary cleanup.
- On reconnect, the client re-sets `online = true` and re-registers `onDisconnect()` to avoid stale handlers.

### Duplicate Listener Prevention

- Track connection state via `.info/connected`. Only set up board listeners once.
- Use a `useRef` flag or connection counter to prevent re-subscribing on every React re-render.
- Firebase SDK's `off()` called on component unmount to clean up listeners.

---

## Conflict Handling & UX Rules

### Strategy: Last-Write-Wins with Local Authority

Firebase Realtime DB uses last-write-wins by default. This is acceptable per the project spec. The following UX rules prevent the worst user-facing artifacts:

### Simultaneous Object Drag (Two users drag the same object)

- **Rule:** While a user is dragging an object, their client ignores incoming remote position updates for that object.
- **Result:** Each dragger sees their own smooth drag. When they release, their final position writes to Firebase. The true last-write-wins — whichever user releases last determines the final position.
- **Remote observers** (not dragging) see the object jump between positions as throttled writes arrive from both draggers. This is acceptable and matches the behavior of most collaborative tools.

### Simultaneous Text Editing (Two users double-click the same sticky)

- **Rule:** Edit lock via presence flag. When User A double-clicks a sticky to edit, `presence/{boardId}/{userId}/editingObjectId` is set to that object's ID.
- **UI:** Other clients see a colored border or "User A is editing..." indicator on that sticky. Double-clicking a locked sticky does nothing (or shows a tooltip: "User A is editing this").
- **Lock release:** On blur, Enter, or disconnect (`onDisconnect` clears `editingObjectId`).
- **Result:** No simultaneous text edits on the same object. No data loss.

### Simultaneous Object Create

- **No conflict.** Each object gets a unique Firebase push ID. Two users creating objects at the same time simply results in two new objects appearing for everyone.

### Simultaneous Delete + Edit

- **If User A deletes an object while User B is editing it:** User B's textarea overlay closes (the underlying object no longer exists in state). User B sees the object disappear. This is acceptable LWW behavior — deletion wins.

---

## AI Agent Requirement Compliance

### Supported Commands (6+ across all categories)

**Creation Commands (3):**

| Command Example | Tools Called |
|----------------|-------------|
| "Add a yellow sticky note that says 'User Research'" | `createStickyNote(text, x, y, color)` |
| "Create a blue rectangle at position 100, 200" | `createShape(type, x, y, width, height, color)` |
| "Add a frame called 'Sprint Planning'" | `createFrame(title, x, y, width, height)` |

**Manipulation Commands (3):**

| Command Example | Tools Called |
|----------------|-------------|
| "Move all the pink sticky notes to the right side" | `getBoardState()` → filter pink stickies → `moveObject(id, x, y)` for each |
| "Change the sticky note color to green" | `getBoardState()` → identify target → `changeColor(id, color)` |
| "Resize the frame to fit its contents" | `getBoardState()` → calculate bounds → `resizeObject(id, width, height)` |

**Layout Commands (2):**

| Command Example | Tools Called |
|----------------|-------------|
| "Arrange these sticky notes in a grid" | `getBoardState()` → calculate grid positions → `moveObject(id, x, y)` for each |
| "Space these elements evenly" | `getBoardState()` → calculate even spacing → `moveObject(id, x, y)` for each |

**Complex / Multi-Step Commands (3):**

| Command Example | Tools Called |
|----------------|-------------|
| "Create a SWOT analysis template" | `createFrame()` x4 + `createStickyNote()` x4 (labeled Strengths, Weaknesses, Opportunities, Threats) |
| "Build a user journey map with 5 stages" | `createFrame()` x5 + `createStickyNote()` x5 + `createConnector()` x4 |
| "Set up a retrospective board" | `createFrame()` x3 (What Went Well, What Didn't, Action Items) + `createStickyNote()` x3 placeholder notes |

**Total: 11 command types across 4 categories.** Exceeds the minimum of 6.

### Tool Schema (TypeScript)

```typescript
// Minimum tool set per spec
interface AITools {
  createStickyNote(text: string, x: number, y: number, color: string): string; // returns objectId
  createShape(type: 'rectangle' | 'circle' | 'line', x: number, y: number, width: number, height: number, color: string): string;
  createFrame(title: string, x: number, y: number, width: number, height: number): string;
  createConnector(fromId: string, toId: string, style: 'arrow' | 'line'): string;
  moveObject(objectId: string, x: number, y: number): void;
  resizeObject(objectId: string, width: number, height: number): void;
  updateText(objectId: string, newText: string): void;
  changeColor(objectId: string, color: string): void;
  getBoardState(): BoardObject[]; // returns all current board objects for context
}
```

### OpenAI Function Calling Integration

- **Model:** GPT-4o (function calling)
- **Flow:** Client sends natural language → Firebase Cloud Function → OpenAI API with tool schemas → OpenAI returns tool calls → Cloud Function executes tools (writes to Firebase RTDB) → all clients see results via existing real-time listeners
- **`getBoardState()`:** Returns all objects on the board (type, id, position, text, color). For boards with 500+ objects, limit to the 100 most recently modified. Sent as context in the system prompt or as a tool result.
- **Multi-step execution:** For complex commands (e.g., SWOT analysis), GPT-4o can return multiple tool calls in a single response. The Cloud Function executes them sequentially.

### AI Concurrency Model

- **Multiple users issuing AI commands simultaneously:** AI writes go through the same Firebase RTDB paths as manual writes. Conflicts resolve via the same LWW rule.
- **No per-board mutex.** AI commands from different users are independent. If User A says "create a SWOT template" and User B says "add a sticky note" at the same time, both complete independently and all users see all results.
- **Rate limiting:** Max 10 AI commands per user per minute, enforced in the Cloud Function.

### AI Agent Performance Targets

| Metric | Target |
|--------|--------|
| Response latency | <2 seconds for single-step commands |
| Command breadth | 11 command types (exceeds minimum of 6) |
| Complexity | Multi-step operation execution (SWOT = 8 tool calls) |
| Reliability | Strict tool schemas with validation; retry on parse failure |
| Shared state | AI results visible to all users in real-time via existing listeners |

---

## AI-First Development Workflow

### Required: At Least Two AI Coding Tools

| Tool | Role | What It's Used For |
|------|------|--------------------|
| **Claude Code** | Primary coding agent | Feature scaffolding, generating full components and hooks, writing Firebase service layers, refactoring, generating test suites. "Here are my types — generate the useBoard hook with Firebase listeners." |
| **Cursor** | In-editor AI assistant | Inline autocomplete while coding, quick edits, debugging assistance, tab-completion for boilerplate. Used for flow-state coding when Claude Code would be too heavy. |
| **pi-coding-agent** | Secondary coding agent | Alternative perspective on architecture decisions, code review, generating alternative implementations for comparison. |

### MCP Integrations (If Used)

- **Firebase MCP:** Direct database inspection and manipulation from AI tools (if available)
- **GitHub MCP:** PR descriptions, commit message generation, issue tracking from AI context

### AI Development Log Tracking

Throughout the sprint, track and document:

- Which tool was used for each major feature
- 3–5 effective prompts (exact text) that produced good results
- Rough percentage of AI-generated vs hand-written code
- Where AI excelled (boilerplate, service layers, type definitions)
- Where AI struggled (real-time sync edge cases, canvas coordinate transforms, Firebase security rules)

---

## Architecture Summary

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

---

## Build Priority Order

Follows the spec-recommended approach: validate real-time sync first, then layer features.

| Phase | Task | Time Budget | Milestone |
|-------|------|-------------|-----------|
| 1 | Firebase project setup + Auth (Anonymous + Google) + board routing | 2 hours | Can authenticate and navigate to `/board/:id` |
| 2 | Cursor sync — two browsers, cursors moving across screens | 3 hours | Hardest risk validated |
| 3 | Presence system — online list, `onDisconnect()`, reconnect handling | 2 hours | Who's online works, ghost users prevented |
| 4 | Konva canvas — infinite board with pan/zoom | 2 hours | Smooth 60 FPS canvas with viewport |
| 5 | Sticky notes — create, move (throttled drag sync), edit text (with edit lock) | 4 hours | Core object CRUD with real-time sync |
| 6 | Shapes (rectangle) + selection + delete | 2 hours | **MVP GATE COMPLETE (~15 hours)** |
| 7 | Deploy to Vercel + Firebase | 1 hour | Publicly accessible |
| 8 | Remaining shapes (circle, line) + connectors + frames | 4 hours | Full feature set |
| 9 | Multi-select, transforms (resize, rotate), duplicate, copy/paste | 4 hours | Polish |
| 10 | AI agent — Cloud Function + OpenAI + basic commands (create, move, color) | 4 hours | Single-step AI working |
| 11 | AI agent — complex commands (SWOT, retro, journey map) | 4 hours | Multi-step AI working |
| 12 | Integration tests + performance testing + 5-user stress test | 3 hours | All 5 evaluator scenarios pass |
| 13 | Documentation, demo video, cost analysis, social post | 3 hours | **FINAL SUBMISSION** |

**Buffer:** ~9 hours of slack across the 7-day sprint for unexpected issues (sync bugs, deployment issues, AI reliability tuning).

---

## Product Scope: Route 1 — Collab Core + AI Templates

**Strategy:** Nail collaboration stability and sync correctness. Add AI template commands for differentiation. Keep feature scope tight.

**In scope:**
- Rock-solid multiplayer sync (cursors, objects, presence, disconnect recovery)
- Sticky notes, rectangles, circles, lines, frames, connectors
- AI agent with 11 command types including SWOT, retro board, journey map templates
- Anonymous + Google auth
- Deployed on Vercel + Firebase

**Out of scope (explicit cuts):**
- Image upload / embedding
- Export to PDF/PNG
- Undo/redo (complex with multiplayer; defer post-sprint)
- Offline mode
- Board permissions / sharing controls
- Rich text formatting in sticky notes

---

## Key Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cursor sync too expensive (Firebase writes) | Medium | High | Throttle to 30–50ms intervals; separate presence path |
| Object drag jitter on remote clients | Medium | Medium | Local authority rule during drag; throttle at 80ms |
| Ghost users after disconnect | Medium | High | `onDisconnect()` + `lastSeen` heartbeat + client-side pruning |
| Text editing data loss | Low | High | Edit lock via presence flag; single-editor-per-object |
| react-konva performance with 500+ objects | Low | Medium | Konva layers + viewport culling post-MVP |
| AI agent unreliable responses | Medium | Medium | Strict tool schemas; validation; retry on parse failure |
| Firebase Security Rules misconfigured | Medium | High | Write rules early; test with Firebase Emulator |
| 24-hour MVP timeline too tight | Medium | Critical | Follow strict priority order; cut features not sync quality |
| Textarea overlay positioning wrong after pan/zoom | Medium | Medium | Transform textarea coordinates using Konva stage transform matrix |
| Duplicate Firebase listeners on reconnect | Medium | Medium | useRef flag + cleanup on unmount; `.info/connected` listener |

---

## Alternative Routes Considered

| Route | Description | Why Not Chosen |
|-------|-------------|---------------|
| **Firestore + RTDB hybrid** | Firestore for objects, RTDB for presence | More moving parts; not worth it for 24h MVP |
| **Supabase** | Postgres + Realtime channels | Realtime layer is newer; more edge cases for sync |
| **Custom WebSocket + Redis** | Maximum control | Biggest time sink; highest risk of "broken sync" |
| **CRDT (Yjs/Automerge)** | Principled conflict resolution | Integration complexity; AI agent integration harder; overkill for LWW-acceptable spec |
| **Excalidraw fork** | Most built-in features | Modifying internal codebase is risky; harder to add AI agent |
| **Fabric.js** | Rich object model | Less native React integration than react-konva |
