# Performance Analysis — CollabBoard Hot Paths

## Baseline

- **Test suite**: 524 tests, all passing (5.01s total)
- **Benchmarks at N=1000 objects**:

| Operation | Time (ms/iter) | Frequency | Weighted cost |
|---|---|---|---|
| `objectsWithLivePositions` full rebuild | 0.132 | 60/s during drag | 7.9 ms/s |
| `setObjects` spread (Realtime handler) | 0.097 | per Realtime event | variable |
| `zIndexKey` fingerprint string | 0.020 | per objects change | low |
| `parentFrameKey` fingerprint string | 0.019 | per objects change | low |
| Sort by zIndex | 0.008 | only on z-change | negligible |
| Viewport culling filter | 0.007 | per render | negligible |
| TopLevelConnectors filter chain | 0.008 | per render | negligible |

## Top Hotspots

### 1. `restoreObjects` — N+1 sequential DB round-trips (board-crud.ts)
- **Pattern**: N sequential `await supabase.from("objects").upsert(row)` calls
- **Impact**: Undo of frame deletion w/ 20 children = 21 × ~50ms RTT = **1050ms**
- **Fix**: 2 batched upserts (roots then children) = 2 × ~50ms = **100ms**

### 2. `useBoard` Realtime handlers — unbatched setState per event
- **Pattern**: Each Supabase Realtime event → separate `setObjects(prev => ({...prev}))` → separate React render
- **Impact**: 10 concurrent events → 10 × O(N) spreads + 10 React renders
- **Fix**: rAF-batch events → 1 spread + 1 render per animation frame

### 3. Board.tsx frame rendering — redundant computation
- **Pattern**: Board JSX re-computes `contained`/`entering`/`clippedObjects` per frame, duplicating `useViewportCulling.clippedObjectsByFrame`
- **Impact**: ~0.1ms per render for 10 frames × 20 children
- **Note**: Also has a subtle behavioral difference (`draggingRef` vs `liveDraggedSet`)

## Opportunity Matrix

| # | Candidate | Impact | Conf | Effort | I×C/E | Isomorphic? |
|---|---|---|---|---|---|---|
| 1 | Batch `restoreObjects` (N→2 round-trips) | 5 | 5 | 1 | **25** | ✓ |
| 2 | rAF-batch Realtime events | 4 | 5 | 3 | **7** | ✓ (final state) |
| 3 | Use `clippedObjectsByFrame` in Board frame JSX | 2 | 4 | 2 | 4 | ✗ (bug fix changes behavior) |
| 4 | Single-pass TopLevelConnectors filter | 1 | 5 | 1 | 5 | ✓ |
| 5 | `Object.assign` in `scheduleDragStateUpdate` | 1 | 5 | 1 | 5 | ✓ |
