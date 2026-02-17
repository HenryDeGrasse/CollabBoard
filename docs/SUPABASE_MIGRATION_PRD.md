# CollabBoard — Supabase Migration PRD

**Status:** Active  
**Date:** February 16, 2026  
**Decision:** Migrate from Firebase to Supabase. Firebase org policies block service account keys AND Blaze billing. Supabase provides free Edge Functions, unrestricted API keys, built-in Realtime Presence, and a generous free tier.

---

## 1. Why Supabase?

### Problems with Firebase (Current)
- Organization policy (`iam.disableServiceAccountKeyCreation`) blocks service account keys
- Blaze plan required for Cloud Functions — billing restrictions on managed Google account
- Firebase RTDB has limited querying capabilities
- No built-in presence system (had to build custom)

### Supabase Advantages
- **Free Edge Functions** (500K invocations/month) — AI agent backend, no billing issues
- **Unrestricted API keys** — anon key + service role key, no org policy blockers
- **Built-in Realtime Presence** — cursor sync, online status, typing indicators (exactly what we need)
- **Realtime subscriptions** — Postgres changes broadcast via websockets (INSERT/UPDATE/DELETE)
- **Row Level Security (RLS)** — SQL-based security policies (more powerful than Firebase rules)
- **PostgreSQL** — proper relational queries, joins, aggregations
- **Supabase Auth** — Anonymous + Google sign-in (same as Firebase)
- **Free tier:** 500MB database, 5GB bandwidth, 50K monthly active users, 500K Edge Function invocations

---

## 2. What Changes vs What Stays

### ✅ Stays the Same (No Changes)
- React 18 + TypeScript (strict) + Vite + Tailwind CSS
- Konva.js via react-konva (all canvas rendering)
- All canvas components: Board, StickyNote, Shape, Frame, Connector, LineTool, RemoteCursor, ResizeHandles, SelectionRect, TextOverlay
- All utility functions: colors, geometry, text-fit, throttle, ids, selection, frame-containment
- All UX patterns: pan, zoom, selection, resize, drag-in/out, hysteresis, keyboard shortcuts
- Vercel frontend hosting
- Test infrastructure: Vitest + Playwright
- Help panel, Toolbar, ColorPicker

### 🔄 Changes (Needs Rewriting)
| Component | Firebase (Current) | Supabase (New) |
|-----------|-------------------|----------------|
| **Auth** | Firebase Auth (Anonymous + Google) | Supabase Auth (Anonymous + Google) |
| **Database** | Firebase Realtime DB (JSON tree) | Supabase PostgreSQL (relational tables) |
| **Realtime Sync** | Firebase `onChildAdded/Changed/Removed` | Supabase Realtime `channel.on('postgres_changes')` |
| **Presence/Cursors** | Custom Firebase presence path + `onDisconnect()` | Supabase Realtime Presence (built-in `track()`/`presenceState()`) |
| **AI Backend** | Vercel Serverless / Firebase Cloud Functions | Supabase Edge Functions (Deno) |
| **Security** | Firebase Security Rules (JSON) | Supabase Row Level Security (SQL policies) |
| **Service Layer** | `src/services/firebase.ts`, `board.ts`, `presence.ts`, `ai-agent.ts` | `src/services/supabase.ts`, `board.ts`, `presence.ts`, `ai-agent.ts` |
| **Auth Components** | `AuthProvider.tsx`, `LoginPage.tsx` | Rewrite for Supabase Auth |
| **Hooks** | `useBoard.ts`, `usePresence.ts`, `useAIAgent.ts` | Rewrite for Supabase client |
| **Dashboard** | `HomePage.tsx` (Firebase queries) | Rewrite queries for Supabase |

---

## 3. Database Schema (PostgreSQL)

### Tables

```sql
-- ─── Board Metadata ───────────────────────────────────────────
CREATE TABLE boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'Untitled Board',
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ DEFAULT NULL
);

-- ─── Board Members (access control) ──────────────────────────
CREATE TABLE board_members (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

-- ─── Board Objects ────────────────────────────────────────────
CREATE TABLE objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sticky', 'rectangle', 'circle', 'line', 'frame', 'text')),
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  y DOUBLE PRECISION NOT NULL DEFAULT 0,
  width DOUBLE PRECISION NOT NULL DEFAULT 150,
  height DOUBLE PRECISION NOT NULL DEFAULT 150,
  color TEXT NOT NULL DEFAULT '#FBBF24',
  text TEXT DEFAULT '',
  rotation DOUBLE PRECISION NOT NULL DEFAULT 0,
  z_index BIGINT NOT NULL DEFAULT 0,
  parent_frame_id UUID DEFAULT NULL REFERENCES objects(id) ON DELETE SET NULL,
  points DOUBLE PRECISION[] DEFAULT NULL,
  stroke_width DOUBLE PRECISION DEFAULT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Connectors ───────────────────────────────────────────────
CREATE TABLE connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  from_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  style TEXT NOT NULL DEFAULT 'arrow' CHECK (style IN ('arrow', 'line')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── User Profiles ────────────────────────────────────────────
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name TEXT NOT NULL DEFAULT 'Anonymous',
  avatar_url TEXT DEFAULT NULL,
  auth_method TEXT NOT NULL DEFAULT 'anonymous' CHECK (auth_method IN ('anonymous', 'google')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── AI Command Runs (idempotency + logging) ─────────────────
CREATE TABLE ai_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id UUID NOT NULL,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'failed')),
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  tool_calls_count INTEGER DEFAULT 0,
  objects_created UUID[] DEFAULT '{}',
  objects_updated UUID[] DEFAULT '{}',
  duration_ms INTEGER DEFAULT 0,
  response JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (board_id, command_id)
);

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_objects_board_id ON objects(board_id);
CREATE INDEX idx_objects_board_updated ON objects(board_id, updated_at DESC);
CREATE INDEX idx_connectors_board_id ON connectors(board_id);
CREATE INDEX idx_board_members_user ON board_members(user_id);
CREATE INDEX idx_ai_runs_board ON ai_runs(board_id, created_at DESC);
```

### Row Level Security (RLS)

```sql
-- Enable RLS on all tables
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;

-- ─── Boards ───────────────────────────────────────────────────
-- Anyone authenticated can create boards
CREATE POLICY "Users can create boards"
  ON boards FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- Members can read their boards
CREATE POLICY "Members can read boards"
  ON boards FOR SELECT TO authenticated
  USING (
    id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- Owner can update their boards
CREATE POLICY "Owner can update boards"
  ON boards FOR UPDATE TO authenticated
  USING (owner_id = auth.uid());

-- ─── Board Members ────────────────────────────────────────────
-- Users can add themselves to boards (join)
CREATE POLICY "Users can join boards"
  ON board_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Members can see other members
CREATE POLICY "Members can see members"
  ON board_members FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- ─── Objects ──────────────────────────────────────────────────
-- Board members can CRUD objects
CREATE POLICY "Members can read objects"
  ON objects FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can create objects"
  ON objects FOR INSERT TO authenticated
  WITH CHECK (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can update objects"
  ON objects FOR UPDATE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can delete objects"
  ON objects FOR DELETE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- ─── Connectors ───────────────────────────────────────────────
-- Same pattern as objects
CREATE POLICY "Members can read connectors"
  ON connectors FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can create connectors"
  ON connectors FOR INSERT TO authenticated
  WITH CHECK (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Members can delete connectors"
  ON connectors FOR DELETE TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );

-- ─── Profiles ─────────────────────────────────────────────────
CREATE POLICY "Anyone can read profiles"
  ON profiles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ─── AI Runs ──────────────────────────────────────────────────
CREATE POLICY "Members can read AI runs"
  ON ai_runs FOR SELECT TO authenticated
  USING (
    board_id IN (SELECT board_id FROM board_members WHERE user_id = auth.uid())
  );
```

### Realtime Setup

```sql
-- Enable realtime on the tables that need live sync
ALTER PUBLICATION supabase_realtime ADD TABLE objects;
ALTER PUBLICATION supabase_realtime ADD TABLE connectors;
```

Note: Presence (cursors, online status) uses Supabase Realtime Presence API (not database tables).

---

## 4. Supabase Realtime Strategy

### Object Sync (Replaces Firebase `onChild*`)

```typescript
// Subscribe to all object changes on a board
const channel = supabase.channel(`board:${boardId}`)
  .on('postgres_changes', {
    event: '*',            // INSERT, UPDATE, DELETE
    schema: 'public',
    table: 'objects',
    filter: `board_id=eq.${boardId}`,
  }, (payload) => {
    switch (payload.eventType) {
      case 'INSERT': handleObjectAdded(payload.new);
      case 'UPDATE': handleObjectChanged(payload.new);
      case 'DELETE': handleObjectRemoved(payload.old);
    }
  })
  .subscribe();
```

### Cursor Sync (Replaces Firebase custom presence path)

```typescript
// Supabase Realtime Presence — built-in, no database writes needed
const channel = supabase.channel(`board:${boardId}`, {
  config: { presence: { key: userId } },
});

// Track your own state
channel.track({
  displayName,
  cursorColor,
  cursor: { x, y },
  editingObjectId: null,
});

// Listen to others
channel.on('presence', { event: 'sync' }, () => {
  const state = channel.presenceState();
  // state = { [userId]: [{ displayName, cursor, ... }] }
});

channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
  // User joined
});

channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
  // User left (automatic on disconnect!)
});
```

**Key advantage:** Supabase handles disconnect cleanup automatically. No need for `onDisconnect()` handlers or ghost user prevention — when the websocket closes, presence is removed.

### Connector Sync

Same pattern as objects — subscribe to `connectors` table changes.

---

## 5. Auth Strategy

### Anonymous Auth

```typescript
// Supabase anonymous sign-in
const { data, error } = await supabase.auth.signInAnonymously();
// Then update profile with display name
await supabase.from('profiles').upsert({
  id: data.user.id,
  display_name: displayName,
  auth_method: 'anonymous',
});
```

### Google Sign-In

```typescript
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: window.location.origin },
});
```

### Auth State Listener

```typescript
supabase.auth.onAuthStateChange((event, session) => {
  if (session) { /* user signed in */ }
  else { /* user signed out */ }
});
```

---

## 6. AI Agent (Supabase Edge Functions)

### Architecture

```
Client (React)
  │
  │ POST /functions/v1/ai-agent
  │ Authorization: Bearer <supabase-access-token>
  │ Body: { commandId, boardId, command, viewport, selectedObjectIds }
  ▼
Supabase Edge Function (Deno)
  │
  ├─ Verify JWT → get user_id
  ├─ Check board membership (SQL query)
  ├─ Check idempotency (ai_runs table)
  ├─ Load board state (SQL query, scoped to viewport)
  ├─ Call OpenAI with tool schemas
  ├─ Execute tool calls (INSERT/UPDATE via service role client)
  ├─ Log usage to ai_runs table
  └─ Return response
  │
  ▼
All clients see results via existing Realtime subscriptions
```

### Edge Function Code Structure

```
supabase/
  functions/
    ai-agent/
      index.ts          # Deno entry point
      lib/
        agent.ts        # OpenAI orchestration
        tools.ts        # Tool implementations (SQL writes)
        toolSchemas.ts  # OpenAI function definitions
        placement.ts    # Deterministic placement resolver
        boardState.ts   # Scoped board state loader
```

### Key Difference from Vercel Approach

- Edge Functions use Deno (not Node.js), but syntax is very similar
- Uses `supabase.auth.getUser(token)` instead of `firebase-admin.auth().verifyIdToken()`
- Uses Supabase service role client for writes (bypasses RLS, like firebase-admin)
- No service account key needed — uses `SUPABASE_SERVICE_ROLE_KEY` env var (auto-configured)

---

## 7. Service Layer Changes

### New: `src/services/supabase.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### Updated: `src/services/board.ts`

```typescript
// Firebase (old)
const ref = dbRef(db, `boards/${boardId}/objects`);
push(ref, objectData);

// Supabase (new)
const { data, error } = await supabase
  .from('objects')
  .insert({ board_id: boardId, ...objectData })
  .select()
  .single();
```

### Updated: `src/services/presence.ts`

```typescript
// Firebase (old) — manual writes to presence path
set(ref(db, `presence/${boardId}/${userId}/cursor`), { x, y });

// Supabase (new) — built-in Realtime Presence
channel.track({ cursor: { x, y }, displayName, cursorColor });
```

---

## 8. Environment Variables

### Client-side (`.env`)

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Edge Functions (auto-configured by Supabase)

```
SUPABASE_URL          # auto-set
SUPABASE_ANON_KEY     # auto-set
SUPABASE_SERVICE_ROLE_KEY  # auto-set
OPENAI_API_KEY        # manually add via Supabase dashboard
```

---

## 9. Migration Implementation Order

| Step | Task | Time | Notes |
|------|------|------|-------|
| **1** | Create Supabase project + run schema SQL | 15min | Dashboard setup |
| **2** | Install `@supabase/supabase-js`, remove `firebase` deps | 10min | Package changes |
| **3** | Create `src/services/supabase.ts` (client init) | 5min | Replace firebase.ts |
| **4** | Rewrite Auth (AuthProvider + LoginPage) | 1-2h | Anonymous + Google |
| **5** | Rewrite `src/services/board.ts` (CRUD operations) | 1-2h | SQL instead of RTDB |
| **6** | Rewrite `useBoard.ts` hook (Realtime subscriptions) | 1-2h | `postgres_changes` |
| **7** | Rewrite `src/services/presence.ts` + `usePresence.ts` | 1-2h | Realtime Presence API |
| **8** | Rewrite `src/pages/HomePage.tsx` (dashboard queries) | 1h | SQL queries |
| **9** | Update `src/pages/BoardPage.tsx` (wire new hooks) | 1h | Integration |
| **10** | Create Supabase Edge Function for AI agent | 2-3h | Port from Vercel `api/` code |
| **11** | Update `src/services/ai-agent.ts` (call Edge Function) | 30min | New endpoint |
| **12** | Update tests | 2-3h | Mock Supabase instead of Firebase |
| **13** | Deploy + test end-to-end | 1-2h | Verify all features |

**Total estimated time: 12-18 hours**

---

## 10. What We Keep from Vercel `/api/` Code

The AI agent logic we already built in `api/_lib/` can be adapted:

| File | Status | Notes |
|------|--------|-------|
| `api/_lib/ai/agent.ts` | ✅ Port to Edge Function | OpenAI orchestration identical |
| `api/_lib/ai/toolSchemas.ts` | ✅ Copy as-is | OpenAI tool definitions unchanged |
| `api/_lib/ai/tools.ts` | 🔄 Rewrite for Supabase | SQL writes instead of RTDB |
| `api/_lib/placement.ts` | ✅ Copy as-is | Pure logic, no Firebase deps |
| `api/_lib/boardState.ts` | 🔄 Rewrite for Supabase | SQL queries instead of RTDB |
| `api/_lib/auth.ts` | 🔄 Rewrite for Supabase | Supabase JWT verification |
| `api/_lib/firebaseAdmin.ts` | ❌ Delete | No longer needed |

---

## 11. Realtime Performance Comparison

| Metric | Firebase RTDB | Supabase Realtime | Notes |
|--------|--------------|-------------------|-------|
| Object sync latency | <100ms | <100ms | Both use persistent connections |
| Cursor sync | 30-50ms (throttled writes) | 30-50ms (Presence API) | Supabase Presence is lighter (no DB writes) |
| Disconnect cleanup | `onDisconnect()` (manual) | Automatic | Supabase handles this natively |
| Max concurrent connections | 200K (Blaze) | 500 (free), 10K (Pro) | Free tier is enough for 5-50 users |
| Presence system | Custom-built | Built-in | Less code to maintain |

---

## 12. Cost Comparison

| | Firebase (Blaze) | Supabase (Free) | Supabase (Pro $25/mo) |
|---|---|---|---|
| Database | 1GB free, then $5/GB | 500MB | 8GB |
| Auth MAU | Unlimited | 50,000 | 100,000 |
| Realtime | Included | 500 concurrent | 10,000 concurrent |
| Functions | 2M invocations free | 500K invocations | 2M invocations |
| Bandwidth | 10GB/month free | 5GB | 250GB |
| **Monthly cost** | $0 + overages | **$0** | **$25** |

For a demo/portfolio project: **Supabase Free tier is more than enough.**

---

## 13. Files to Delete After Migration

```
# Firebase-specific files (remove after migration complete)
firebase.json
.firebaserc
database.rules.json
functions/                    # Entire directory
src/services/firebase.ts      # Replaced by supabase.ts
api/                          # Vercel serverless (replaced by Edge Functions)
.env.emulator                 # Firebase emulator config
```

---

## 14. New File Structure (Post-Migration)

```
src/
├── services/
│   ├── supabase.ts           # Supabase client init
│   ├── board.ts              # Board CRUD (Supabase queries)
│   ├── presence.ts           # Realtime Presence
│   └── ai-agent.ts           # Edge Function client calls
├── hooks/
│   ├── useBoard.ts           # Realtime subscriptions
│   ├── usePresence.ts        # Presence tracking
│   ├── useCanvas.ts          # (unchanged)
│   ├── useSelection.ts       # (unchanged)
│   ├── useAIAgent.ts         # Edge Function calls
│   └── useUndoRedo.ts        # (unchanged)
├── components/
│   ├── auth/
│   │   ├── AuthProvider.tsx   # Supabase Auth context
│   │   └── LoginPage.tsx      # Anonymous + Google
│   ├── canvas/               # (all unchanged)
│   ├── toolbar/              # (all unchanged)
│   ├── sidebar/              # (unchanged)
│   └── ui/                   # (unchanged)
supabase/
├── functions/
│   └── ai-agent/
│       ├── index.ts
│       └── lib/              # Agent, tools, schemas, placement
├── migrations/
│   └── 001_initial_schema.sql
└── config.toml
```

---

## 15. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Supabase Realtime latency higher than Firebase | Low | Medium | Benchmark early; throttle cursor updates if needed |
| Anonymous auth differences | Low | Low | Test thoroughly; Supabase anonymous auth is well-documented |
| Edge Function cold starts | Medium | Low | First call may be slow (~1s); subsequent calls fast |
| Breaking existing tests | High | Medium | Update mocks incrementally; keep canvas tests unchanged |
| Data migration from Firebase | Low | Low | Start fresh (no existing production data worth migrating) |

---

## 16. Success Criteria

- [ ] All 9 MVP requirements pass (Section 6.1 of original PRD)
- [ ] All 5 evaluator test scenarios pass
- [ ] 153+ tests passing (updated for Supabase mocks)
- [ ] AI agent executes 6+ command types reliably
- [ ] Objects appear where the user is looking (viewport-aware placement)
- [ ] Cursor sync <100ms, object sync <200ms
- [ ] Deployed and publicly accessible
