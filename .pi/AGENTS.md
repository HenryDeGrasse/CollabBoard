# CollabBoard Development Rules

## Test-Driven Development (TDD)

All bug fixes and new features MUST follow TDD:

1. **Red** — Write failing test(s) first that reproduce the bug or define the expected behavior
2. **Green** — Implement the minimum code to make the tests pass
3. **Refactor** — Clean up while keeping tests green

### Workflow
- Before writing any implementation code, write tests that:
  - For bugs: reproduce the exact failure condition
  - For features: assert the expected behavior
- Run tests to confirm they FAIL (red phase)
- Then implement the fix/feature
- Run tests to confirm they PASS (green phase)
- Commit with both tests and implementation

### Test Stack
- **Vitest** + **jsdom** + **@testing-library/react** + **jest-dom**
- Test files go in `src/test/` mirroring source structure
- Firebase and Konva are mocked in `src/test/setup.ts`
- Run: `npm test` (all) or `npx vitest run src/test/path/to/test.ts` (single)

## Commit Discipline

**After every message/response, make a git commit** with all current changes. This ensures incremental progress is never lost. Use Conventional Commits format. Only commit; do NOT push unless the user explicitly asks.

## ⛔ MANDATORY: Push & Deploy Gate

### NEVER push or deploy without explicit user approval.

- **`git push`** — ALWAYS ask the user "Ready to push?" and wait for a clear "yes" / "go ahead" / "push it" BEFORE running the command. No exceptions.
- **`vercel --prod`** (or any deploy command) — ALWAYS ask the user "Ready to deploy to production?" and wait for explicit approval BEFORE running. No exceptions.
- **If the user says "push to production"** in the same message as a feature request, implement the feature first, then ASK before actually running push/deploy.
- Committing locally (`git commit`) is fine without asking — that's just local safety. Pushing and deploying affect production and other people.

### Why
`git push` triggers Vercel auto-deploy. Running it without permission can ship broken or unfinished work to production. The user must always have final say.

## Quality Gates & Deployment Pipeline

### Before Every Commit
- All tests MUST pass (`npm test`)
- Husky pre-commit hook enforces this automatically

### Before Every Push
- All tests MUST pass AND the build MUST succeed (`npm run preflight` = test + build)
- Husky pre-push hook enforces this automatically

### Deployment Flow
1. **Develop & test locally** — verify features work on `localhost:5174`
2. **Commit** — tests run automatically via pre-commit hook
3. **ASK the user for permission** — "Ready to push/deploy?"
4. **Only after explicit approval**: push to GitHub / deploy to Vercel
5. **Never push broken code** — if tests or build fail, fix before pushing

### Production
- Frontend hosted on **Vercel** (NOT Firebase Hosting)
- Live URL: `https://collabboard-eta.vercel.app`
- GitHub: `https://github.com/HenryDeGrasse/CollabBoard`
- Firebase project: `collabboard-a45b9`

## Design & UX Rules

### Canvas Interaction
- **Space + drag** for panning (Figma/Miro pattern)
- **Right-click + drag** also pans (context menu suppressed on canvas)
- **Regular drag** (no modifier) for selection rectangle
- Tools auto-reset to Select tool after creating an object or completing an arrow
- New objects are auto-selected after creation

### Object Behavior
- **Sticky notes** resize as squares only (aspect-locked)
- **Rectangles** resize freely (8 handles)
- **Circles** resize with aspect lock (4 cardinal handles)
- **Luminance-based text color** — dark text on light backgrounds, white text on dark backgrounds

### Selection
- Intersection-based detection (any overlap with selection rect selects the object)
- Connectors selected when their line segment intersects the selection rect
- Multi-select group drag moves all selected objects together
- Connectors update in real-time during group drag

### Keyboard Shortcuts
- V = Select, S = Sticky, R = Rectangle, C = Circle, A = Arrow, L = Line
- Delete/Backspace = Delete selected
- Escape = Cancel current action
- Cmd/Ctrl+C = Copy, Cmd/Ctrl+V = Paste, Cmd/Ctrl+D = Duplicate
- Cmd/Ctrl+Z = Undo, Cmd/Ctrl+Shift+Z = Redo

### Undo/Redo
- Per-user local command stack (max 30 depth)
- Only undoes YOUR actions (multiplayer-safe, like Google Docs/Figma)
- Tracks: create, delete, move, update, batch actions

## Dev Environment Management

### After Every Change
After completing code changes, **always restart the dev environment** so the user can test manually:

1. **Rebuild**: `npm run build` to verify TypeScript + Vite compilation
2. **Run tests**: `npm test` to verify all tests pass
3. **Restart API dev server**: The API server runs at `localhost:3000` via `npx tsx api/_dev-server.mjs` in a tmux session (`vercel-api`). After changing any `api/` files, restart it:
   ```bash
   SOCKET="${TMPDIR:-/tmp}/claude-tmux-sockets/claude.sock"
   tmux -S "$SOCKET" send-keys -t vercel-api:1.1 C-c
   sleep 1
   tmux -S "$SOCKET" send-keys -t vercel-api:1.1 -- 'cd /Users/henrydegrasse/Development/GauntletAi/CollabBoard && npx tsx api/_dev-server.mjs' Enter
   ```
4. **Vite dev server** runs on `localhost:5173` in tmux session `collabboard-dev` — usually does NOT need restart (HMR handles frontend changes)

### Long-Running Processes
**NEVER run long-running processes directly in bash** — they block the agent. Always delegate to tmux:
- Use the tmux skill for starting/restarting servers
- Socket: `${TMPDIR:-/tmp}/claude-tmux-sockets/claude.sock`
- Sessions: `collabboard-dev` (vite), `vercel-api` (API server)
- Windows are numbered starting at `1` (use `:1.1` not `:0.0`)

## Architecture Decisions

- **Frame tool in toolbar** — F shortcut, spatial containment, no nesting
- **Arrow tool in toolbar** — more useful for MVP demos than frame tool
- **AI agent deployment deferred to last** — requires Firebase Blaze plan + OpenAI API key
- **Test files excluded from production build** — `tsconfig.app.json` excludes `src/test`

## AI Agent Architecture

### Tool Pipeline
`src/hooks/useAIAgent.ts` → `src/services/ai-agent.ts` → `api/ai-agent.ts` → `api/_lib/ai/agent.ts` (orchestrator) → `api/_lib/ai/tools.ts` (tool implementations)

### Key Files
- **Tool schemas**: `api/_lib/ai/toolSchemas.ts` — OpenAI function calling definitions
- **Tool implementations**: `api/_lib/ai/tools.ts` — server-side execution
- **Orchestrator**: `api/_lib/ai/agent.ts` — system prompt, dispatch, guardrails
- **Grid layout**: `api/_lib/framePlacement.ts` — `arrangeChildrenInGrid()`, `placeObjectInFrame()`
- **Free placement**: `api/_lib/placement.ts` — `resolvePlacement()` spiral overlap avoidance
- **Board state**: `api/_lib/boardState.ts` — `getBoardStateForAI()` loads up to 200 objects

### Bulk Tools (prefer these for 3+ objects)
- **`bulkCreate`** — creates any mix of stickies, shapes, frames in one call. Color can be hex, "random", or omitted.
- **`bulkDelete`** — mode "all" (wipe board), "by_type" (delete all stickies/shapes/frames), or "by_ids" (specific objects)
- **`arrangeObjects`** — arrange objects into grid/row/column layout
- **`rearrangeFrame`** — tidy frame children into grid
