# AI Agent Improvements — Implementation Plan (Ready to Build)

_Last updated: 2026-02-22_

This document turns the original improvement ideas into an execution-ready plan tied to the **current codebase**:

- `api/ai.ts`
- `api/_lib/aiAgent.ts`
- `api/_lib/aiTools.ts`
- `src/components/sidebar/AICommandInput.tsx`

---

## 0) Current State (after code pass)

| Area | Status | Notes |
|---|---|---|
| Complexity routing | ✅ Implemented | `classifyComplexity()` chooses simple vs complex model. |
| Compact board context | ✅ Implemented (partial scope) | `buildBoardContext()` returns full for small boards and digest for large boards. |
| Template fast paths (SWOT/Kanban/Retro) | ✅ Implemented | Regex-triggered handlers + deterministic layout tools. |
| Progress streaming | ✅ Implemented | SSE emits `meta`, `tool_start`, `tool_result`, `text`, `navigate`, `done`. |
| Scoped on-demand retrieval tool | ❌ Missing | No `get_board_context` style tool; `fetchBoardState` still loads full board in API entrypoint. |
| Plan → Validate → Execute pipeline | ❌ Missing | Current runtime is direct tool-calling loop. |
| Dynamic toolset per request | ❌ Missing | Static `TOOL_DEFINITIONS` always sent. |
| Resumable runs (`commandId`) | ❌ Missing | No `/api/ai-continue` flow in active codepath. |
| Version-aware/idempotent command execution | 🟡 Schema exists, runtime missing | Migration exists (`008_*`) but not integrated in AI runtime. |
| Auto-repair loop | ❌ Missing | Tool errors returned, no structured correction pass. |
| Eval harness / replay | ❌ Missing | No fixture replay runner yet. |

---

## 1) Goals and Success Metrics

### Product goals
1. Reduce timeout/failure perception for multi-step commands.
2. Improve deterministic behavior for layout-heavy requests.
3. Make long operations observable and resumable.

### Engineering KPIs
- **P95 time to first visible response (SSE event)**: `< 1.0s`
- **P95 end-to-end for common commands** (single-step create/edit): `< 4.0s`
- **Command completion rate** (no manual retry required): `>= 97%`
- **Template command deterministic success** (SWOT/Kanban/Retro fixtures): `>= 99%`
- **Retry duplication rate**: `0` duplicated objects for same `commandId`

---

## 2) Implementation Plan by Phase

### Phase A (P0) — Context + Tooling Foundations

### A1. Add scoped board retrieval (`get_board_context`)

**Why**: Avoid full board reads when only selected/viewport/frame data is required.

**Changes**
- Add new tool in `api/_lib/aiTools.ts`:
  - `get_board_context({ scope, ids?, frameId?, bbox?, types?, limit? })`
  - Supported scopes: `board_summary | selected | viewport | frame | ids`
- Add helper query functions:
  - `fetchBoardSummary(boardId)`
  - `fetchObjectsByIds(boardId, ids)`
  - `fetchObjectsInBbox(boardId, bbox, types?, limit?)`
  - `fetchFrameWithChildren(boardId, frameId, limit?)`
- Keep `read_board_state` for fallback/debug only.

**Acceptance criteria**
- Agent can resolve “selected”, “viewport”, and “specific IDs” without full board dump.
- `read_board_state` invocation rate drops on large-board fixtures.

---

### A2. Dynamic toolset selection

**Why**: Smaller tool schema = lower token load and less wrong-tool usage.

**Changes**
- In `api/_lib/aiAgent.ts`, replace static `tools: TOOL_DEFINITIONS` with:
  - `selectToolDefinitions({ command, complexity, hasSelection })`
- Start with 3 buckets:
  - `edit-basic`: create/update/delete/search/read/navigate/arrange/duplicate
  - `layout`: `createQuadrant/createColumnLayout/createMindMap/createFlowchart/createWireframe`
  - `maintenance`: clear/fit/filter operations

**Acceptance criteria**
- Each request sends only necessary tool definitions.
- No regression in existing tool flows.

---

### A3. Harden deterministic templates

**Why**: Fast paths exist, but should be unified and testable.

**Changes**
- Extract template builders from `aiAgent.ts` into `api/_lib/aiTemplates.ts`:
  - `buildSwotLayout(...)`
  - `buildKanbanLayout(...)`
  - `buildRetroLayout(...)`
- Keep model role to **content generation only**.
- Add rollback contract for partial failures in template creation paths.

**Acceptance criteria**
- Template outputs are stable on repeated runs (same topic + same seed inputs).
- Partial DB writes are cleaned up on template failure.

---

### Phase B (P1) — Plan / Validate / Execute Runtime

### B1. Introduce explicit planner step

**Why**: Prevent mid-loop drift and improve debuggability.

**Changes**
- Create `api/_lib/aiPlanner.ts` with strict JSON schema:
  - `{ intent, steps[], requiresRead, estimatedOps, riskLevel }`
- New run path in `runAgent()`:
  1. `plan`
  2. `validatePlan`
  3. `executePlan`
  4. `summarize`

**Acceptance criteria**
- Every non-fast-path run has a persisted plan object in memory/logs.
- Planner output is schema-validated before execution.

---

### B2. Add preflight validator

**Why**: Fail early on malformed plans/unsafe actions.

**Validation checks**
- Unknown tools
- Missing required IDs
- Excessive operation count (budget)
- Destructive actions without explicit user intent

**Changes**
- `api/_lib/aiValidation.ts`
- Structured error format:
  - `{ code, message, retryable, suggestions[] }`

**Acceptance criteria**
- Invalid plans never reach DB mutation stage.
- Validator errors surface as user-readable SSE error summaries.

---

### B3. Execution engine with step-level progress events

**Why**: Better UX and recoverability.

**Changes**
- Add step progress events from API:
  - `plan_ready`
  - `step_started`
  - `step_succeeded`
  - `step_failed`
- Extend `AICommandInput.tsx` to render step progress list.

**Acceptance criteria**
- User sees which step is currently running.
- Failures identify exact failed step and reason.

---

### Phase C (P2) — Resumability, Idempotency, Conflicts, Observability

### C1. Command run persistence + resume API

**Why**: Timeouts/disconnects should be recoverable.

**Changes**
- Use `ai_runs` table actively from `api/ai.ts`.
- Require client-sent `commandId` (UUID) in request body.
- Add `api/ai-continue.ts`:
  - Input: `{ boardId, commandId }`
  - Resumes from last unfinished step.

**Acceptance criteria**
- Re-sending same `commandId` does not duplicate completed steps.
- Interrupted run can continue successfully.

---

### C2. Board version conflict handling

**Why**: Multi-user edits can invalidate plans mid-run.

**Changes**
- Capture `board_version_start` at run start.
- Before each mutation step, compare current board version.
- Policies:
  - **Small delta**: auto-replan once.
  - **Large delta**: emit `needs_confirmation` state.

**Acceptance criteria**
- Clear conflict status surfaced to UI.
- No silent overwrite when board diverges significantly.

---

### C3. Backend validation + auto-repair loop

**Why**: Convert common failures into recoverable retries.

**Changes**
- Tool execution returns typed errors (`VALIDATION_ERROR`, `NOT_FOUND`, `CONSTRAINT_ERROR`, etc.).
- One bounded repair attempt (`maxRepairAttempts = 1`) for retryable errors.

**Acceptance criteria**
- Retryable failures show measurable recovery rate increase.
- Non-retryable failures terminate fast with clear reason.

---

### C4. Eval harness and replay fixtures

**Why**: Prevent regressions and compare routing/prompt changes safely.

**Changes**
- Add `scripts/ai-eval.ts`:
  - Loads fixture board JSON + command
  - Runs planner/executor in dry-run mode
  - Produces pass/fail + latency metrics
- Add `docs/ai-evals/fixtures/*.json`

**Acceptance criteria**
- CI job can run deterministic eval suite.
- Baseline metrics versioned in repo.

---

## 3) API / Contract Changes

### Request body (`POST /api/ai`)

```json
{
  "boardId": "uuid",
  "command": "string",
  "commandId": "uuid",
  "conversationHistory": [{ "user": "...", "assistant": "..." }],
  "viewport": { "x": 0, "y": 0, "scale": 1 },
  "screenSize": { "width": 1440, "height": 900 },
  "selectedIds": ["..."]
}
```

`commandId` becomes required in Phase C.

### SSE event envelope

```json
{ "type": "step_started", "content": "{...json...}" }
```

Additive event types (backward-compatible):
- `plan_ready`
- `step_started`
- `step_succeeded`
- `step_failed`

---

## 4) Rollout Strategy (Feature Flags)

Use env flags to ship safely:

- `AI_ENABLE_SCOPED_CONTEXT`
- `AI_ENABLE_DYNAMIC_TOOLSET`
- `AI_ENABLE_PLANNER_PIPELINE`
- `AI_ENABLE_RESUME`
- `AI_ENABLE_AUTO_REPAIR`

Rollout order:
1. Dev local
2. Staging board(s)
3. 10% prod traffic
4. 50% prod traffic
5. 100%

Each phase requires: no error-rate regression + KPI target met for 48h.

---

## 5) Test Plan

### Unit
- `buildBoardContext` edge cases (large boards, selected objects)
- `selectToolDefinitions` routing matrix
- planner schema parsing/validation
- validator error classification

### Integration (API)
- `/api/ai` with scoped context tool calls
- planner failure vs execution failure behavior
- idempotent replays with same `commandId`
- resume flow via `/api/ai-continue`

### E2E
- Template commands (SWOT/Kanban/Retro)
- “Reorganize selected into columns” on medium and large boards
- Simulated disconnect + resume
- Conflict scenario with collaborator edits mid-run

---

## 6) Definition of Done (per phase)

- [ ] Code merged behind feature flag
- [ ] Unit + integration + e2e tests added and passing
- [ ] README/API docs updated
- [ ] Observability dashboards updated
- [ ] Rollout + rollback notes documented

---

## 7) Immediate Next Tickets (recommended order)

1. `A1` Add `get_board_context` tool + tests.
2. `A2` Add dynamic toolset selector.
3. `A3` Extract template module and add rollback tests.
4. `B1/B2` Introduce planner + validator behind `AI_ENABLE_PLANNER_PIPELINE`.

This sequence gives the largest reliability gains with the lowest migration risk.
