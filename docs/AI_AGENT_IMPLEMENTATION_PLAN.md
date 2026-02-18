# AI Agent Implementation Plan (Supabase Edge Functions)

**Status:** Active — Implementation  
**Last Updated:** February 16, 2026  
**Backend:** Supabase Edge Functions (Deno runtime)  
**Observability:** LangFuse for tracing + LangSmith for evaluation  
**Model:** OpenAI GPT-4o (function calling)

---

## Architecture

```
Client (AICommandInput.tsx)
  → useAIAgent hook computes viewport + selection
  → sendAICommand() → POST /functions/v1/ai-agent
    with Authorization: Bearer <supabase_access_token>

Supabase Edge Function (ai-agent/index.ts)
  → Verify JWT → uid
  → Authorize uid on boardId (query board_members)
  → Check idempotency (ai_runs table)
  → Load board state (objects + connectors in viewport)
  → Call OpenAI GPT-4o with tool schemas
    → LangFuse trace wraps the entire call chain
  → Execute tool calls → Supabase DB writes
  → Log usage to ai_runs
  → Return response

Realtime:
  → All clients see DB writes via existing postgres_changes channels
```

---

## Observability Stack

### LangFuse (Primary — Tracing + Cost Analysis)
- **Purpose:** Trace every AI call chain, measure latency per tool, track token usage/cost
- **Integration:** LangFuse JS SDK in the Edge Function
- **What we trace:**
  - Full generation span (model, prompt, completion, tokens, latency)
  - Each tool execution as a child span
  - Board state loading as a span
  - Total request lifecycle
- **Dashboard:** trace explorer, cost per user/board, latency percentiles

### LangSmith (Secondary — Evaluation + Debugging)
- **Purpose:** Log runs for offline evaluation, prompt versioning, regression detection
- **Integration:** LangSmith tracing via `LANGCHAIN_TRACING_V2=true`
- **What we log:** Same OpenAI calls, for prompt iteration and A/B testing

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI API access |
| `LANGFUSE_SECRET_KEY` | LangFuse server auth |
| `LANGFUSE_PUBLIC_KEY` | LangFuse project identifier |
| `LANGFUSE_BASEURL` | LangFuse API endpoint (default: `https://cloud.langfuse.com`) |
| `LANGSMITH_API_KEY` | LangSmith tracing |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access (bypasses RLS) |

---

## Non-Negotiable Requirements

1. **Server-side auth only.** Verify Supabase JWT, derive `uid`. Never trust client `userId`.
2. **Board authorization.** Check `board_members` table before any mutation.
3. **Viewport-aware placement.** Deterministic `resolvePlacement()` server-side.
4. **Guardrails.** Max 25 tool calls, max 25 objects, clamp sizes/coords, sanitize text.
5. **Idempotency.** `commandId` UUID from client prevents duplicate runs.
6. **Observability.** Every AI call traced in LangFuse with token counts + latency.

---

## Tool Schema (9 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `create_sticky_note` | `text, x, y, color` | Creates sticky note |
| `create_shape` | `type, x, y, width, height, color` | Creates rectangle/circle |
| `create_frame` | `title, x, y, width, height` | Creates named frame |
| `create_connector` | `fromId, toId, style` | Creates arrow/line between objects |
| `move_object` | `objectId, x, y` | Moves object |
| `resize_object` | `objectId, width, height` | Resizes object |
| `update_text` | `objectId, newText` | Updates text |
| `change_color` | `objectId, color` | Changes fill color |
| `get_board_state` | *(none)* | Returns current objects for context |

---

## Guardrails

| Guardrail | Value |
|-----------|-------|
| Max iterations | 6 |
| Max tool calls | 25 |
| Max objects created | 25 |
| Min object size | 50×50 |
| Max object size | 2000×2000 |
| Max text length | 500 chars |
| Coordinate clamp | ±50000 |
| OpenAI timeout | 30 seconds |
| Rate limit | 10 commands/user/minute |

---

## Implementation Order

| Step | Task |
|------|------|
| 1 | Add env vars (OpenAI, LangFuse, LangSmith, Supabase service role) |
| 2 | Create Edge Function `ai-agent` with auth + validation |
| 3 | Implement board state loader (scoped to viewport) |
| 4 | Implement placement resolver |
| 5 | Implement tool schemas + tool executor |
| 6 | Implement OpenAI tool loop with LangFuse tracing |
| 7 | Wire client → Edge Function URL |
| 8 | Test 6+ required commands |
| 9 | Add auto-pan/auto-select on response |

---

## System Prompt

```
You are an AI assistant for a collaborative whiteboard called CollabBoard.
You manipulate the board using the provided tools. Always use tools — never respond with text only.

The user's visible viewport in canvas coordinates:
  Top-left: ({minX}, {minY}), Bottom-right: ({maxX}, {maxY})
  Center: ({centerX}, {centerY}), Zoom: {scale}x

{boardStateContext}

{selectedContext}

Guidelines:
- Place new objects within the user's viewport, near the center
- Use consistent spacing: 200px between stickies, 280px between frames
- Avoid overlapping existing objects
- For templates (SWOT, retro, kanban, journey map), create a well-organized layout
- Use create_frame for grouping related items
- Connect related items with create_connector

Available colors: yellow (#FBBF24), pink (#F472B6), blue (#60A5FA), green (#34D399),
orange (#FB923C), purple (#C084FC), red (#F87171), gray (#9CA3AF), white (#F8FAFC).
```
