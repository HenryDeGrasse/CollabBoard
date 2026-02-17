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
3. **Push to GitHub** — tests + build run automatically via pre-push hook
4. **Vercel deploys from GitHub** — only push when local dev is verified
5. **Never push broken code** — if tests or build fail, fix before pushing
6. **NEVER push to GitHub (which triggers Vercel deploy) without explicit user approval** — always ask "Ready to push/deploy?" and wait for confirmation before running `git push`

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

## Architecture Decisions

- **Frame tool in toolbar** — F shortcut, spatial containment, no nesting
- **Arrow tool in toolbar** — more useful for MVP demos than frame tool
- **AI agent deployment deferred to last** — requires Firebase Blaze plan + OpenAI API key
- **Test files excluded from production build** — `tsconfig.app.json` excludes `src/test`
