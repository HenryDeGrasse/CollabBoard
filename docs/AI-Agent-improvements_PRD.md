## Prioritized improvements (impact vs effort)

| Priority | Change                                                                                 | Impact on timeouts/reliability |   Effort | Primary wins                                                               |
| -------: | -------------------------------------------------------------------------------------- | -----------------------------: | -------: | -------------------------------------------------------------------------- |
|       P0 | **Stop embedding full board; switch to scoped “board digest” + on-demand retrieval**   |                      Very high |  Low–Med | Cuts tokens/latency immediately; reduces noise                             |
|       P0 | **Dynamic toolset + fewer, higher-level tools (batch patch + templates)**              |                      Very high |      Med | Fewer schemas, fewer round-trips, fewer failure modes                      |
|       P0 | **Deterministic template engine for SWOT/Kanban/Retro; LLM generates content only**    |                           High |      Med | Removes layout reasoning + tool spam; predictable execution                |
|       P1 | **Plan → Validate → Execute (explicit structured plan, not tool-calling immediately)** |                      Very high | Med–High | Prevents mid-execution confusion; supports previews, budgets, resumability |
|       P1 | **Replace keyword routing with a cheap intent/complexity router**                      |                           High |  Low–Med | Stops overusing gpt-4o; routes scope/tools correctly                       |
|       P1 | **Progress streaming + job state (SSE and/or Supabase realtime)**                      |                       Med–High |      Med | Makes “long” operations feel reliable; easier debugging                    |
|       P2 | **Resumable execution + idempotency + board versioning/conflict handling**             |                           High |     High | Eliminates “timeout = broken”; safe in collaborative edits                 |
|       P2 | **Backend validation + auto-repair loop (structured errors the model can correct)**    |                           High | Med–High | Turns many failures into recoverable retries                               |
|       P2 | **Observability + eval harness (replay on fixture boards)**                            |               High (long-term) |      Med | Systematic reliability improvements; regression prevention                 |

Everything below is a concrete implementation plan for these items.

---

## P0. Scoped context + on-demand retrieval (stop sending 200 objects every time)

### Technical approach

**1) Introduce a compact “BoardDigest” format** (server-generated, not LLM-generated) and include only what’s necessary per request.

* Always include:

  * `boardVersion` (monotonic integer; see P2)
  * viewport bounds
  * selected IDs
  * counts by type (frames/stickies/connectors)
  * list of frames (id, title, bounds, childCount)
* Conditionally include:

  * **selected objects** (full detail)
  * **objects in viewport** (detail capped; e.g., 50)
  * **frame children** for frames referenced by selection or command

**2) Make `getBoardState` scoped and parameterized** (or add a new tool `getBoardContext`).

Instead of one “dump everything” tool, support:

* `scope`: `"selected" | "viewport" | "frame" | "board_summary" | "ids"`
* `ids?: string[]`
* `frameId?: string`
* `bbox?: {x1,y1,x2,y2}`
* `types?: ("sticky"|"shape"|"frame"|"connector")[]`
* `fields`: `"geometry" | "text_snippet" | "style" | "parent" | "connector_endpoints"`
* `limit`, `cursor` (for pagination)

**3) Route context selection before calling the model** using deterministic rules + the router (P1):

* If command contains “entire board / everything / reorganize / kanban / swot / retro”: include **board_summary + frames + connectors summary**, not full objects; fetch full only if needed.
* If selection exists and command implies local edit (“make these…”, “move selected…”): include **selected objects only**.
* If command implies add/create near view: include **viewport only**.

**4) Use a token-lean representation**

* Short keys (`id,t,x,y,w,h,p,txt,c`)
* `txt` truncated (e.g., 60 chars)
* Elide null/default fields
* Prefer arrays over verbose objects where stable.

Example digest line format (very token-efficient):

```
FRAME f12 "Kanban"  (x=120,y=80,w=1200,h=800) children=28
OBJ s55 sticky (x=160,y=140,w=220,h=120,p=f12,c=yellow,txt="Backlog: …")
```

### Why this fixes your current failures

* The model stops paying 10K+ tokens of “attention tax” on simple commands.
* Complex commands still get enough structure (frames + counts) to plan without drowning in irrelevant stickies.

### Tradeoffs

* The model may occasionally request additional context; that’s acceptable if you keep `getBoardContext` fast and scoped.
* Requires careful digest design so it’s predictable and doesn’t omit critical invariants.

### Implementation steps

1. Add server function `buildBoardDigest({boardId, viewport, selectedIds, intent})`.
2. Refactor `getBoardState` into `getBoardContext` with scopes and field masks.
3. Update system prompt to explicitly instruct: “Assume digest is partial; request more via getBoardContext only when needed.”

---

## P0. Dynamic toolset + consolidate into fewer high-leverage tools

You currently pay latency and confusion cost for **15 schemas** every call.

### Technical approach

**1) Dynamic tool selection per request**

* The orchestrator chooses `tools` array per request rather than always sending all 15.
* Example:

  * “add a sticky”: `{ applyPatch }`
  * “SWOT”: `{ createTemplate, applyPatch }`
  * “reorganize into kanban”: `{ planBoardReorg, applyPatch, arrangeObjects }`
  * “what’s on this board?”: `{ getBoardContext }`

**2) Replace most fine-grained tools with one batch mutation tool**
Add a single tool:

#### `applyPatch(boardId, expectedVersion, transactionId, ops[])`

Where `ops[]` is a small set of primitives:

* `create`: sticky/shape/frame/connector (supports `clientId` for idempotency)
* `update`: partial patch (text/color/geometry/parentFrameId)
* `delete`
* `setParent` (add/remove frame containment)
* `connect` (connector endpoints)

Server responsibilities:

* Fill default placement when x/y absent (use your existing engines)
* Enforce constraints (frame containment, auto-expansion)
* Return:

  * `results`: `{clientId->id}` mappings, updated ids
  * `undoOps` (for client undo/redo grouping)
  * `newBoardVersion`

**3) Keep only a few specialized deterministic tools**

* `createTemplate(...)` (see next section)
* `arrangeObjects(...)` and `rearrangeFrame(...)` (already deterministic)
* `getBoardContext(...)`

This cuts the schema list drastically and makes the agent less brittle.

### Tradeoffs

* Backend becomes the “truth” for mutation semantics; you’ll write more validation code.
* Patch schema must be stable; changes require migration and backward compatibility.
* You must implement good error messages when constraints are violated.

### Implementation steps

1. Add `applyPatch` endpoint/tool and keep old tools temporarily behind it.
2. Update `tools.ts` to translate old tool calls into patch ops during migration.
3. Switch the model to only see `applyPatch` for most sessions.

---

## P0. Deterministic template engine (SWOT/Kanban/Retro): LLM generates content, not geometry

Your layouts are predictable; the LLM should not be computing x/y positions.

### Technical approach

**1) Implement a server-side template catalog**
Represent templates as code or JSON specs (code is often easier to maintain with types):

* `swot`:

  * Root frame (optional)
  * 4 quadrant frames positioned deterministically
  * Children stickies per quadrant auto-gridded via your frame layout engine
* `kanban`:

  * Frame with N column frames
  * Column headers
  * Optional swimlanes as nested frames or row layout
* `retro`:

  * “Went well / To improve / Actions” columns
  * Optional voting dots (shapes)

**2) Add tool: `createTemplate({type, anchor, size, title, structure, content})`**

* `anchor`: near viewport center or in selected frame
* `structure`: parameters (columns, labels, wip limits, includeVoting)
* `content`: arrays of strings (stickies), optionally grouped

**3) Content generation is a separate, small LLM call**
For SWOT:

* Input: user command + optionally a small snippet of existing board text (not geometry)
* Output JSON:

  * `strengths[]`, `weaknesses[]`, `opportunities[]`, `threats[]`
* Model: `gpt-4o-mini` is typically sufficient.

Then execute template deterministically with one `applyPatch` or direct DB transaction.

### Tradeoffs

* Less flexible for non-standard layouts unless you expose template parameters.
* Requires template versioning (if you change the layout, old boards might differ).

### Implementation steps

1. Add `templates/` module that returns a list of ops for `applyPatch`.
2. Add `createTemplate` tool that returns `{transactionId, createdIds, undoOps}`.
3. Update router: if intent is one of these templates, bypass “general agent loop.”

---

## P1. Plan → Validate → Execute (separate reasoning from tool execution)

This directly addresses: “no planning step”, “monolithic call”, “wrong order”, “runs out of tool calls”.

### Target behavior

* First call produces a **structured plan** with explicit step count, estimated object deltas, and risk flags.
* Backend validates plan against budgets and invariants.
* Executor runs steps with deterministic tools and batched patches.

### Technical approach

**1) Add a “Planner” LLM call (no tools)**
Use `response_format` (JSON) and require:

```json
{
  "intent": "template|reorganize|edit|cleanup|query",
  "scope": "selected|viewport|board",
  "steps": [
    {"id":"s1","type":"query","need":"frame_list"},
    {"id":"s2","type":"mutate","operation":"createTemplate","args":{...}},
    {"id":"s3","type":"layout","operation":"rearrangeFrame","args":{...}}
  ],
  "budgets": {"maxCreates": 80, "maxDeletes": 0, "maxMoves": 200},
  "risks": {"destructive": false, "needsConfirmation": false}
}
```

**2) Backend plan validator**
Before executing:

* Compute predicted creates/deletes/moves from the plan.
* Reject or require confirmation if:

  * deletes > 0 and not explicitly requested
  * `bulkDelete all` type operation
  * predicted creates exceed MAX_OBJECTS_CREATED
  * scope is `board` but command ambiguous
* If needs confirmation: return a preview summary (counts and what will be removed/changed).

**3) Executor runs steps**

* For each step:

  * Fetch missing scoped context if required (via SQL, not LLM)
  * Execute deterministic tools (`createTemplate`, `arrangeObjects`, `applyPatch`)
  * Emit progress events (P1 streaming)
* Keep LLM out of inner loops as much as possible.

**4) When a second LLM call is needed**
Only for content generation (text) or ambiguous mapping; keep it small-context and tool-free.

### Tradeoffs

* Adds at least one additional LLM call for complex operations.
* Requires plan schema maintenance and validator updates as capabilities grow.
* But it drastically reduces “agent drift” mid-execution and makes operations previewable/auditable.

### Implementation steps

1. Create `plan.ts`: plan schema + zod validation.
2. Implement `validatePlan(plan, boardMeta)` returning either “ok” or “needsConfirmation” or “reject”.
3. Implement `executePlan(plan)` with step handlers.

---

## P1. Replace keyword routing with an intent/complexity router

Keyword routing fails because complexity is not tied to template words.

### Technical approach

**Option A (recommended): one cheap router call using `gpt-4o-mini`**
Input:

* command
* selected count
* board counts (frames/stickies/connectors)
* whether command includes destructive verbs
  Output JSON:
* `intent`, `scope`, `complexityScore (0-1)`, `needsFullContext`, `needsContentGen`, `preferredModel`, `allowedTools`

This router call can be combined with the planner call (planner includes routing outputs) to avoid extra calls.

**Option B: heuristic router**
If you want zero extra LLM calls:

* Complexity score from:

  * command length
  * conjunction count (“and then”, commas)
  * verbs that imply global operations (“reorganize”, “convert”, “cluster”, “summarize”)
  * requested output size (“10 stickies”, “a full retro”)
  * board size
    This is cheaper but less accurate.

### Concrete routing policy

* `intent=edit` and scope selected/viewport → `gpt-4o-mini`, `tools=[applyPatch]`
* `intent=template` → `gpt-4o-mini` for content, no general agent loop
* `intent=reorganize` with board scope and connectors present → planner `gpt-4o`, executor mostly deterministic
* Any “summarize / infer themes / write content based on board text” → allow `gpt-4o` but fetch only relevant text snippets

### Tradeoffs

* Router/planner call costs tokens, but it prevents expensive misroutes to `gpt-4o` and prevents over-fetching board context.

---

## P1. Progress feedback (streaming + persisted job state)

You need to eliminate the “spinner of death” and make partial completion visible.

### Technical approach

**1) Introduce `ai_jobs` table**
Fields:

* `id`, `board_id`, `user_id`
* `command`, `status` (`planning|executing|done|error|needs_confirmation`)
* `plan_json`, `progress` (0..1), `current_step`
* `created_at`, `updated_at`
* `error_json`
* `transaction_id`, `board_version_start`, `board_version_end`

**2) Publish progress via one of these (or both):**

* **SSE** from Vercel route:

  * events: `job_created`, `plan_ready`, `step_started`, `step_done`, `done`, `error`
* **Supabase realtime** subscription on `ai_jobs` row:

  * resilient if SSE disconnects, also useful for collaboration (others see progress)

**3) Client UX**

* Show step list (“Planning”, “Creating frames”, “Adding stickies”, “Arranging layout”)
* Apply intermediate board updates as soon as they commit (your realtime updates already support this)

### Tradeoffs

* SSE on serverless can be finicky; realtime DB updates are more robust but add write load.
* Persisted jobs add schema + cleanup requirements.

---

## P2. Resumable execution + idempotency + conflict handling (for real trust)

This is what makes “reorganize my entire board” safe in a collaborative environment.

### Technical approach

**1) Board versioning**

* Add `board_version` integer in a `boards` table (or metadata table).
* Increment on each committed mutation batch.
* Every `applyPatch` includes `expectedVersion`.

  * If mismatch: return `{error: "version_conflict", currentVersion, changedSummary}`.

**2) Idempotency**

* Every job has a `transactionId`.
* Every create op includes `clientId` (UUID stable across retries).
* DB schema includes `(board_id, client_id)` unique constraint so retry won’t duplicate.

**3) Resumable step cursor**

* Store `current_step_index` in `ai_jobs`.
* On timeout or client disconnect, client can call `/continue` with jobId.
* Executor reads job, resumes at next uncompleted step.

**4) Collaboration conflicts**
For board-wide reorganizations:

* If boardVersion changes mid-job:

  * Either (a) pause and request user confirmation to rebase, or
  * (b) re-fetch digest and re-plan (automatic replan, but only if changes are small)
    A practical policy:
* Auto-replan only if changes are within a small delta (e.g., <= 10 objects changed); otherwise ask.

### Tradeoffs

* More backend complexity (job lifecycle, idempotency keys, version conflicts).
* But this is the main ingredient for reliability under real multi-user edits.

---

## P2. Validation + structured error recovery

Right now failures are likely “tool error → confused model → wasted iterations.”

### Technical approach

**1) Strict backend validation with precise, actionable errors**
Return machine-readable errors:

```json
{
  "error": "invalid_parent",
  "message": "Object cannot be added to frame because it already belongs to another frame",
  "details": {"objectId":"...", "currentParent":"...", "targetParent":"..."},
  "suggestedFix": "removeFromFrame first"
}
```

**2) Auto-repair loop**
Executor logic:

* If error is repairable and within retry budget:

  * Provide error JSON to the model with: “produce a corrected patch only”
  * Apply corrected patch
    This is more reliable than letting the model continue freeform.

**3) Safety gates**

* Destructive operations require explicit confirmation unless the command is unambiguous (“delete everything on this board”).
* Large moves/reshuffles should generate a preview summary before applying.

### Tradeoffs

* Requires a taxonomy of error types and good server messages.
* But it converts many failures into predictable recoveries.

---

## P2. Observability + evaluation harness (mandatory for sustained reliability)

### Technical approach

**1) Structured logging per job**
Capture:

* router output
* plan JSON
* context sizes (tokens, object counts)
* tool calls and latencies
* validation errors and retries
* final outcome

**2) Replay harness**

* Create fixture boards (JSON snapshots) representing common messy states.
* Run a suite of prompts against them in CI:

  * “convert to kanban”
  * “cluster stickies by theme”
  * “clean up overlaps”
  * “summarize decisions”
* Score: success/failure, object count, constraint violations, timeouts.

**3) Shadow mode rollout**

* For a period, generate plan using new planner but execute old path; compare predicted ops vs actual.
* Then switch execution.

### Tradeoffs

* Extra engineering and storage costs.
* It prevents regressions and is the only scalable way to improve trust.

---

## Concrete phased implementation plan (in dependency order)

### Phase 1: Immediate timeout reduction (P0)

1. **Implement `BoardDigest` + context selector** and stop embedding full board JSON by default.
2. **Parameterize `getBoardContext`** (scopes, fields, limit).
3. **Dynamic tools**: send only the few tools needed per intent.

Definition of done:

* “add sticky” requests no longer include 200 objects.
* p95 latency drops; timeouts for simple commands eliminated.

### Phase 2: Remove LLM-from-layout for templates (P0)

4. Implement `createTemplate` for SWOT/Kanban/Retro using deterministic placement + your existing layout engines.
5. Add small content-generation call returning structured content JSON.

Definition of done:

* “Create a SWOT analysis” executes in 1–2 backend steps with a single mutation batch.

### Phase 3: Reliability core (P1)

6. Add **planner call** (tool-free) → plan JSON.
7. Add **plan validator** + confirmation flow for destructive/large operations.
8. Add **executor** that runs plan steps using deterministic tools + `applyPatch`.

Definition of done:

* Multi-step operations execute in correct order with bounded creates/tool calls.
* Tool-call loops mostly disappear; MAX_ITERATIONS becomes less important.

### Phase 4: UX trust layer (P1)

9. Add `ai_jobs` table + realtime progress updates (SSE optional, realtime required).
10. Client shows stepwise progress and applies incremental mutations.

Definition of done:

* Users see “Planning / Creating / Arranging” and partial results appear as they commit.

### Phase 5: Collaboration-safe and resumable (P2)

11. Add `board_version`, idempotent `clientId`, and resumable job cursor.
12. Add conflict handling policy (auto-replan small deltas; otherwise pause).

Definition of done:

* A job can survive retries/timeouts without duplicating objects.
* Mid-collaboration edits don’t silently corrupt outcomes.

### Phase 6: Hardening (P2)

13. Implement structured errors + auto-repair loop.
14. Add eval harness + replay CI.

Definition of done:

* You can quantify success rate by command category and prevent regressions.

---

## Key design tradeoffs summary

* **More backend logic vs fewer LLM failures:** Consolidating tools and deterministic templates shifts complexity to the server, but dramatically improves reliability and reduces token spend.
* **Extra LLM call (planning) vs fewer retries/timeouts:** Planning adds cost, but prevents long tool loops and mid-execution confusion. Use `gpt-4o-mini` for planning where possible.
* **Streaming/progress vs operational complexity:** Job records and progress events add moving parts, but are required for perceived reliability and debugging.
* **Strict validation vs flexibility:** Validation will reject some creative/ambiguous outputs; that’s desirable for “trust me with my board” operations.

---

## Most important “trust” feature for full-board reorg

Implement **Plan → Validate → Execute** with:

* a preview/confirmation gate for destructive or large-scale changes,
* idempotent resumable execution,
* board version conflict handling.

That combination is what prevents “it half-worked, now my board is weird,” which is the failure mode that destroys user trust.

