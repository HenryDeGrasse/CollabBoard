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
