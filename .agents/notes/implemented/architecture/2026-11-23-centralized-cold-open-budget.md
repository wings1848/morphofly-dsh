# Agent Note: One cold-open budget for every path that materializes a log

Status: implemented

English | [中文](2026-11-23-centralized-cold-open-budget.zh.md)

## Problem

The cold-open heap guard priced only `SessionObservationReader.read()`. Every other path that materializes a complete stored log bypassed it: `SessionCorpus.load` and `projectMany` through `inspectPersisted`, and the SQLite search index build through its own `readColdSessionLog` call. Model tools reach sessions through those paths, so an oversized session could still exhaust the host heap, and the guard's `SESSION_QUERY_SESSION_TOO_LARGE` was unreachable from the tools that needed it ([issue #7](https://github.com/wings1848/morphofly-dsh/issues/7)).

The check also compared one free-heap reading and then yielded before reading anything, so two concurrent opens could each pass with the same headroom and materialize twice.

## Decision

[`cold-open-budget.ts`](../../../../packages/session-query/session-query/src/cold-open-budget.ts) owns one `ColdOpenBudget` per `SessionQueryEngine`. The budget prices a stored artifact at `coldOpenHeapMultiplier`, compares it with `coldOpenHeapShare` of the free heap that remains after other in-flight reads, and reserves the estimate before the read. `reserve` returns its release; every caller releases in `finally`. Check and reserve are synchronous, so the JS thread is the only mutator and no lock is needed.

The engine hands the same instance to `SessionObservationReader`, `SessionCorpus`, and — through a protected accessor — `SqliteSessionQueryEngine`'s index build. Corpus reads pass the listed snapshot's `sizeBytes`; the SQLite entry map now carries `sizeBytes` too. `inspectPersisted` rethrows `SessionQueryError` unchanged, because wrapping the refusal as `SESSION_QUERY_PERSISTENCE_FAILED` is what made the guard unreachable on corpus paths.

## Alternatives considered

**Keep one guard per path.** Each caller would copy the estimate, share, and message; the copies drift, and no copy can see another path's in-flight read, so the concurrency hole stays.

**Hold the budget in a module-scope singleton.** A module-level cache or singleton has no owner in this architecture and would leak policy between independently mounted engines.

**Reserve the whole unknown size instead of the estimate.** A backend that reports no `sizeBytes` cannot be priced without reading, and reserving a guess would refuse reads that fit. The budget passes unpriced reads and prices priced ones.

## Consequences

Every materializing path now refuses an oversized session before opening it, and concurrent opens spend one shared reservation. The refusal message and code stay identical to the previous single-path guard, so existing callers and tests keep their expectations. The SQLite index build pays one reservation per listed session and releases it as each read finishes.

Still open from #7: stable client-facing codes through the Gateway and Web history controller, and the cache byte-budget edge cases (pinned entries undercounted; an oversized pinned entry cannot be evicted).

## Testing

`cold-open-budget.spec.ts` covers unpriced reads, a disabled share, the multiplier, an in-flight reservation that makes a second open fail and succeed after release, the idempotent release, and the refusal message. `observation-heap.spec.ts` keeps pinning the operator-facing message through the reader.
