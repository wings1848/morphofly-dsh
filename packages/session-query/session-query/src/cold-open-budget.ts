/**
 * Heap pricing and in-flight reservation shared by every path that materializes
 * a stored session log: point observations, corpus reads, and the search index
 * build.
 *
 * Reservation is what keeps concurrent cold opens from each spending the same
 * free headroom: a read subtracts its estimate before yielding, so N parallel
 * opens are priced against the heap the others already claimed. The budget is
 * in-process and synchronous; the JS thread is the only mutator, so
 * check-and-reserve needs no lock.
 */

import { getHeapStatistics } from 'node:v8'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from './config.ts'

/**
 * Prices one cold read against free V8 heap and reserves that estimate for the
 * duration of the read.
 */
export class ColdOpenBudget {
  /** Active reservation total, in estimated heap bytes. */
  private reserved = 0

  /**
   * @param share - share of free heap one read may estimate; `0` disables pricing.
   * @param multiplier - estimated heap bytes per stored artifact byte.
   */
  constructor(
    private readonly share: number,
    private readonly multiplier: number,
  ) {}

  /**
   * Estimate the heap one cold read of a stored artifact retains.
   * @param sizeBytes - stored artifact size, when the backend reports one.
   * @returns estimated heap bytes; `0` when the backend reports no size.
   */
  estimate(sizeBytes: number | undefined): number {
    return sizeBytes === undefined ? 0 : Math.ceil(sizeBytes * this.multiplier)
  }

  /**
   * Reserve the estimate for one read, refusing when it claims more than its
   * share of the free heap that remains after other in-flight reads.
   * @param sessionId - session about to load.
   * @param sizeBytes - stored artifact size, when the backend reports one.
   * @returns release for the reservation; a no-op when the read is unpriced or pricing is disabled.
   * @throws {SessionQueryError} `SESSION_QUERY_SESSION_TOO_LARGE` when the estimate does not fit.
   */
  reserve(sessionId: SessionId, sizeBytes: number | undefined): () => void {
    if (this.share === 0 || sizeBytes === undefined) return noopRelease
    const estimated = this.estimate(sizeBytes)
    const free = Math.max(0, freeHeapBytes() - this.reserved)
    const budget = Math.floor(free * this.share)
    if (estimated > budget) {
      throw new SessionQueryError(
        `session "${sessionId}" is too large to open: about ${formatBytes(estimated)} of heap for ${formatBytes(sizeBytes)} stored, but only ${formatBytes(free)} of heap is free; close other Sessions or restart the host with a larger heap`,
        'SESSION_QUERY_SESSION_TOO_LARGE',
      )
    }
    this.reserved += estimated
    let released = false
    return () => {
      if (released) return
      released = true
      this.reserved -= estimated
    }
  }
}

/** Release for an unpriced read, which reserved nothing. */
const noopRelease = (): void => {}

/** Free V8 heap one cold open may estimate against, in bytes. */
function freeHeapBytes(): number {
  return Math.max(0, getHeapStatistics().heap_size_limit - process.memoryUsage().heapUsed)
}

/** Render a byte count for an operator-facing refusal message. */
function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit] as string}`
}
