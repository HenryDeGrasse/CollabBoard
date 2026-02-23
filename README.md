# CollabBoard — Real-time Collaborative Whiteboard

**🌐 Live Demo: [collab-board-ochre-gamma.vercel.app](https://collab-board-ochre-gamma.vercel.app)**

A real-time collaborative whiteboard for brainstorming, diagramming, and running workshops simultaneously on an infinite canvas. Built with React + Konva + Supabase.

---

## ✨ Features

### 🎯 Core Tools
- **Sticky Notes** — Color-customizable notes with auto-fit text, resize, and drag
- **Shapes** — Rectangles and circles with editable text and fill colors
- **Lines** — Straight line segments for annotations
- **Connectors/Arrows** — Smart arrows that attach to objects and follow during drag
- **Frames** — Named containers with clipping, drag-in/out hysteresis, and object-count badges
- **Text** — Freestanding text blocks at any size

### 🖼️ Canvas & Interaction
- **Infinite Canvas** — Pan with `Space + Drag` or right-click drag; zoom 10–400%
- **60 FPS Local Rendering** — Drag state flushed via `requestAnimationFrame`; network broadcast throttled separately
- **Viewport Persistence** — Zoom/pan position saved per board and restored on return
- **Multi-select** — Drag-to-select rectangle with intersection detection
- **Object Rotation** — Drag the rotation handle above any selection; `Shift` snaps to 15° increments
- **Frame Resize → Push Children** — Resizing a frame pushes contained objects inward (Figma/Miro style)
- **Smart Layering** — Connectors and lines render above frames; frames clip contained objects

### 🎨 Text & Style
- **Tier-1 Text Controls** — Font size (A− / A+) and text color picker for all text-bearing objects
- **Auto-fit Text** — Text automatically scales to fit the object bounds
- **Luminance-aware Color** — Text color auto-switches dark/light based on fill for readability

### ⌨️ Keyboard Shortcuts
- **Tools**: `V` Select · `S` Sticky · `R` Rect · `C` Circle · `A` Arrow · `L` Line · `F` Frame
- **Edit**: `⌘/Ctrl+Z` undo · `⌘/Ctrl+⇧+Z` redo · `⌘/Ctrl+C/V/D` copy/paste/duplicate
- **Canvas**: `Delete/Backspace` delete · `Escape` return to Select tool · `?` toggle shortcuts panel
- Platform-aware: shows `⌘` on Mac, `Ctrl` on Windows/Linux

### 👥 Multiplayer
- **Live Cursors** — Adaptive micro-interpolation matches broadcast interval; snaps on first appearance
- **Real-time Sync** — All object changes propagate within <100ms via Supabase Realtime
- **Edit Locking** — Visual lock indicator when another user is editing an object
- **Live Draft Preview** — See collaborators' text as they type (italic, color-coded)
- **Presence Panel** — Online users list
- **Header Share Menu** — Copy board link / board ID from the top-right Share button

### 🗂️ Dashboard
- **My Boards / Shared with Me** — Create, search, soft-delete, and join boards
- **Board Thumbnails** — Auto-captured JPEG preview on navigate-away; displayed as card artwork
- **Grid / List View** — Toggle between card grid and compact list
- **Join by ID** — Enter any board ID to open a shared board

### 🤖 AI Agent
- **Natural Language Commands** — Type commands like "create a SWOT analysis" or "add 3 sticky notes"
- **Complexity Router** — Heuristic classifier routes simple vs. complex requests to different models
- **Fast-path Templates** — Deterministic SWOT / Kanban / Retro builders with AI-generated content
- **Compact Board Context** — Uses full board state for small boards and digest mode for large boards
- **Search-first Tooling** — `search_objects` for targeted lookup, `read_board_state` when full context is needed
- **Specialized Layout Tools** — Quadrant, columns, mind map, flowchart, and wireframe creation tools
- **Streaming UX** — SSE progress updates (`tool_start`, `tool_result`, text tokens, and navigation events)

> Planned next-phase improvements are tracked in [`docs/agent-improvements.md`](docs/agent-improvements.md).

### 🔐 Authentication
- **Email / Password** — Full sign-up and sign-in via Supabase Auth
- **Google OAuth** — One-click sign-in with persistent identity
- **Guest Access** — Enter a display name to join immediately (anonymous auth)

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript (strict) + Vite |
| Styling | Tailwind CSS |
| Canvas | Konva.js via react-konva |
| Database & Auth | Supabase (Postgres + Row Level Security + Realtime) |
| API / AI Backend | Vercel Serverless Functions + OpenAI (tool-calling models) |
| Hosting | Vercel |
| Testing | Vitest (unit/integration) + Playwright E2E |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- [OrbStack](https://orbstack.dev/) or Docker Desktop (for local Supabase)
- A [Supabase](https://supabase.com) account (for production)
- An [OpenAI](https://platform.openai.com) API key (for the AI agent)

### 1 — Clone and install

```bash
git clone https://github.com/HenryDeGrasse/CollabBoard.git
cd CollabBoard
npm install
```

### 2 — Start local Supabase

```bash
npx supabase start
```

This boots a full local Supabase stack via Docker (Postgres, Auth, Realtime, Studio) and automatically applies all database migrations. First run pulls ~1GB of images; subsequent starts are instant.

### 3 — Create `.env.local`

Copy the credentials printed by `supabase start` (or run `npx supabase status -o json`):

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Local Supabase (overrides .env for local dev — never committed)
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon key from supabase status>

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase status>

OPENAI_API_KEY=sk-your-openai-key
```

### 4 — Run frontend + API dev servers

Terminal A (frontend):

```bash
npm run dev
```

Terminal B (local API server with `.env.local` precedence):

```bash
npx tsx api/_dev-server.mjs
```

Open http://localhost:5173.

### 5 — Verify API is targeting local Supabase

```bash
curl http://localhost:3000/api/health
```

Expected `supabaseUrl`:

```json
{"supabaseUrl":"http://127.0.0.1:54321", "hasServiceKey": true}
```

If `supabaseUrl` points to `*.supabase.co`, restart the API dev server. Otherwise browser auth tokens from local Supabase will fail with `401 Unauthorized`. All local data writes should go to your local Supabase instance — production stays untouched.

---

## 🗄️ Local Development Environment

CollabBoard uses **two separate databases** — local for development, cloud for production:

```
npm run dev   ──▶  localhost:54321     (Docker via OrbStack — isolated)
Vercel prod   ──▶  <project>.supabase.co  (production cloud)
```

### How the two-file convention works

| File | Purpose | Committed? |
|---|---|---|
| `.env` | Production credentials (fallback) | No (gitignored) |
| `.env.local` | Local dev credentials (overrides `.env`) | No (gitignored) |
| `.env.example` | Documented template with placeholders | Yes |

Vite loads `.env.local` first, then `.env`. When `.env.local` exists, local dev always hits the local Supabase. Vercel reads from its own dashboard env vars — it never touches either file.

### Local Supabase commands

| Command | What it does |
|---|---|
| `npx supabase start` | Boot local stack (Postgres + Auth + Realtime + Studio) |
| `npx supabase stop` | Shut down all containers |
| `npx supabase db reset` | Wipe database and re-run all migrations from scratch |
| `npx supabase status` | Show URLs and keys |
| `npx supabase status -o json` | Machine-readable output (useful for scripting) |
| `npx supabase migration new <name>` | Create a new migration file |
| `npx supabase db push` | Push local migrations to linked production project |

**Local Studio UI:** http://127.0.0.1:54323 — browse tables, write SQL, inspect auth users.  
**Local email/inbox:** http://127.0.0.1:54324 — catch all emails sent by local Auth.

### Running a new migration

```bash
# 1. Create the migration file
npx supabase migration new my_change

# 2. Write SQL in supabase/migrations/<timestamp>_my_change.sql

# 3. Apply locally (reset re-runs all migrations)
npx supabase db reset

# 4. Test thoroughly

# 5. Push to production (requires approval — see AGENTS.md)
npx supabase db push
```

---

## 📁 Project Structure

```
src/
├── components/
│   ├── canvas/       # Board, StickyNote, Shape, Connector, Frame, RotationHandle, RemoteCursor
│   ├── toolbar/      # Toolbar, ColorPicker, StrokeWidthPicker
│   ├── sidebar/      # PresencePanel, TextStylePanel, AICommandInput
│   ├── ui/           # HelpPanel
│   └── auth/         # AuthProvider, LoginPage
├── hooks/            # useBoard, usePresence, useCanvas, useSelection,
│                     # useUndoRedo, useCursorInterpolation
├── services/         # supabase, board CRUD/access, presence
├── types/            # board, presence, ai
├── utils/            # colors, geometry, throttle, ids, text-fit, text-style,
│                     # text-overlay-layout, selection, frame-containment, frame-placement
├── test/             # Vitest suites (hooks, components, services, integrations)
└── pages/            # HomePage (dashboard), BoardPage (canvas)
api/
├── ai.ts             # Main AI entrypoint (SSE stream at /api/ai)
├── health.ts         # Local API diagnostics (/api/health)
├── _dev-server.mjs   # Local API dev server
└── _lib/
   ├── aiAgent.ts     # Agent loop, complexity routing, board digesting
   ├── aiTools.ts     # Tool schemas + Supabase execution layer
   ├── auth.ts
   └── supabaseAdmin.ts
supabase/
└── migrations/       # 001–013 SQL migrations
docs/                 # PRDs, planning artifacts
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│  React + Konva (Browser)            │
│  useBoard → Supabase Realtime       │
│  usePresence → cursor broadcast     │
│  AICommandInput → /api/ai           │
└──────────┬──────────────────────────┘
           │ HTTPS / WebSocket
┌──────────▼──────────────────────────┐
│  Supabase                           │
│  ├── Postgres (boards, objects)     │
│  ├── Row Level Security (RLS)       │
│  ├── Realtime (broadcast channels)  │
│  └── Auth (email, Google, anon)     │
└──────────────────────────────────────┘
           │ Vercel Serverless
┌──────────▼──────────────────────────┐
│  /api/ai                            │
│  ├── Complexity classifier          │
│  ├── Board context (full/digest)    │
│  ├── OpenAI tool-calling loop       │
│  └── Tool executor (Supabase CRUD)  │
└──────────────────────────────────────┘
```

### Performance & Sync Strategy
- **Unthrottled local rendering** — drag positions flush via `requestAnimationFrame` for 60fps+ visual feedback
- **Throttled network broadcast** — collaborator updates sent at 50ms intervals (20 updates/sec)
- **Cursor interpolation** — adaptive linear lerp matches measured broadcast interval; rAF loop sleeps when cursors are stationary
- **Drag heartbeat** — re-broadcasts every 600ms while dragging to prevent jump-back on collaborators' screens
- **Last-write-wins** conflict resolution

### AI Agent Pipeline (current)
```
AICommandInput.tsx
  → POST /api/ai (SSE)
    → verifyToken() + assertCanWriteBoard()
    → fetchBoardState()
    → classifyComplexity()      — simple vs complex model selection
    → buildBoardContext()       — full or digest context payload
    → runAgent() tool loop      — stream text + tool events
      → executeTool()           — Supabase mutations/search/layout tools
```

Future architecture work (planner, resumability, idempotent command runs) is defined in `docs/agent-improvements.md`.

---

## ✅ Testing

```bash
npm test              # Run all Vitest unit/integration suites
npm run test:watch    # Watch mode
npm run test:e2e      # Playwright end-to-end suite
```

Test coverage includes hooks, canvas rendering/interaction, API routes, AI tool execution, and integration flows.

---

## 🚦 Quality Gates

Husky hooks run on every commit and push:

- **Pre-commit**: all Vitest tests must pass
- **Pre-push**: tests + production build must both pass

---

## 📦 Deployment

### Vercel (Frontend + API functions)

Automatic on push to `main` (if GitHub connected). Manual:

```bash
COLLAB_PUSH_APPROVED=1 git push   # bare git push is blocked by the pre-push hook
vercel --prod                      # only after explicit approval
```

> ⛔ **Must get explicit approval before pushing or deploying** — see `AGENTS.md`.
> A husky pre-push hook blocks plain `git push` (mirrors the pip → uv pattern).
> Approved pushes require `COLLAB_PUSH_APPROVED=1 git push`.

**Environment variables** (set in Vercel dashboard — not from `.env` files):

| Variable | Where used |
|---|---|
| `VITE_SUPABASE_URL` | Client-side (browser) |
| `VITE_SUPABASE_ANON_KEY` | Client-side (browser) |
| `SUPABASE_URL` | Server-side (API functions) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side (API functions) |
| `OPENAI_API_KEY` | Server-side (AI agent) |

### Supabase (Database migrations)

Apply new migrations to production:

```bash
npx supabase link --project-ref <project-ref>   # one-time link
npx supabase db push                             # push pending migrations
```

---

## 🔑 Key Design Decisions

| Decision | Rationale |
|---|---|
| Local Supabase for dev | Isolates test data from production; free; `db reset` gives a clean slate |
| `.env.local` overrides `.env` | Matches Vite's load order; production keys never touched during dev |
| rAF for local drag state | Accumulates positions in refs, flushes once per frame — no throttle on local rendering |
| Frame resize pushes children inward | Idempotent clamping to frame content bounds; matches Figma/Miro behavior |
| Compact board digest for AI | ~95% token reduction vs. full JSON; heuristic router adds zero extra LLM calls |
| Fail-fast + rollback for templates | On any DB error during template creation, immediately delete partially-created objects |
| Cursor interpolation adaptive duration | Measured broadcast interval clamped [8ms, 80ms]; rAF loop sleeps when all cursors settled |
| Drag heartbeat broadcast (600ms) | Prevents collaborator jump-back when the dragging user holds still |
| Board thumbnails in localStorage | Instant, no DB migration; per-device tradeoff acceptable for MVP |
| Undo reverts own actions only | Standard collaborative app approach (depth 30) |

---

## 🗺️ Roadmap

- **DB Environment Branching** — Supabase branch-per-PR for isolated migration testing
- **Access Control** — Public/private boards, share by link or email
- **Export** — PNG/SVG image export, JSON board export
- **Conflict-aware Replanning** — Auto-replan small version deltas, pause for confirmation on large conflicts
- **AI Drawing Intent** — Natural language object placement and diagramming

---

## 📄 License

MIT — see LICENSE for details.
