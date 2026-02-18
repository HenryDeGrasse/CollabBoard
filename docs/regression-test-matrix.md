# Regression Test Matrix

This matrix maps recent high-risk features to explicit test coverage so regressions are caught quickly.

## AI reliability / Phase 5 (P2)

| Feature | Test file(s) | Coverage |
|---|---|---|
| Resume interrupted AI jobs (`/api/ai-continue`) | `src/test/services/ai-continue-route.test.ts` | method guard, auth failures, payload validation, missing jobs, completed short-circuit, resume execution, error handling |
| Client resume API wiring (`continueAICommand`) | `src/test/services/ai-agent.test.ts` | endpoint path, payload shape (`selectedIds`), auth headers, network failure behavior |
| Board version helpers | `src/test/services/ai-versioning.test.ts` | read/increment version, conflict detection, idempotent create, race-condition fallback |
| Job progress persistence | `src/test/services/ai-versioning.test.ts` | update payload mapping, no-op behavior, load/normalize resumable job row |

## Local auth/dev-environment safety

| Feature | Test file(s) | Coverage |
|---|---|---|
| API health diagnostics (`/api/health`) | `src/test/services/health-route.test.ts` | non-secret config output, local Supabase URL visibility |

## Canvas/text editing UX

| Feature | Test file(s) | Coverage |
|---|---|---|
| Text overlay vertical alignment estimator | `src/test/utils/text-overlay-layout.test.ts` | top/middle/bottom offsets, overflow clamping, invalid-dimension safety |
| Keyboard/help discoverability updates | `src/test/components/help-panel.test.tsx` | Creating + Connectors sections, connector midpoint deletion hint |

## Existing high-value suites (kept)

- `src/test/integration/ai-command-input.test.tsx`
- `src/test/utils/ai-router.test.ts`
- `src/test/hooks/usePresence.test.ts`
- `src/test/utils/frame-containment.test.ts`
- Playwright E2E: `e2e/*`

## Recommended pre-push checks

```bash
npm test
npm run build
npm run test:e2e   # optional for quick local edits, required before major releases
```
