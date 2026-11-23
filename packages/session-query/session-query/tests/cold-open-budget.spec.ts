/** In-process heap reservation shared by every path that materializes a stored session log. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ColdOpenBudget } from '../src/cold-open-budget.ts'

const heapLimit = vi.hoisted(() => ({ bytes: 0 }))

vi.mock('node:v8', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:v8')>()
  return {
    ...actual,
    // Only the limit is under test; the rest of the module stays real.
    getHeapStatistics: () => ({ ...actual.getHeapStatistics(), heap_size_limit: heapLimit.bytes }),
  }
})

const sessionId = SessionId('cold')
const OTHER = SessionId('cold-other')

/** Free heap exactly 1000 B for every case: the mocked limit minus a mocked heapUsed of 0. */
function freeHeap(bytes: number): void {
  heapLimit.bytes = bytes
  vi.spyOn(process, 'memoryUsage').mockReturnValue({ heapUsed: 0 } as NodeJS.MemoryUsage)
}

afterEach(() => { vi.restoreAllMocks() })

describe('ColdOpenBudget', () => {
  it('prices an unpriced read as free', () => {
    freeHeap(1000)
    const budget = new ColdOpenBudget(0.5, 8)
    expect(budget.estimate(undefined)).toBe(0)
    const release = budget.reserve(sessionId, undefined)
    release()
    expect(() => budget.reserve(OTHER, 10)).not.toThrow()
  })

  it('disables pricing at share 0', () => {
    freeHeap(1000)
    const budget = new ColdOpenBudget(0, 8)
    expect(() => budget.reserve(sessionId, 1000)).not.toThrow()
    expect(() => budget.reserve(OTHER, 1000)).not.toThrow()
  })

  it('prices the stored artifact at the configured multiple', () => {
    freeHeap(10_000)
    const budget = new ColdOpenBudget(0.5, 8)
    expect(budget.estimate(100)).toBe(800)
  })

  it('reserves the estimate before the read, so a concurrent open sees only the remainder', () => {
    freeHeap(1000)
    const budget = new ColdOpenBudget(0.5, 8)
    // 10 B stored prices 80 B of heap; the 500 B share still has room.
    const release = budget.reserve(sessionId, 10)
    // The next read prices against 920 B free, whose half is 460 B: 480 B no longer fits.
    expect(() => budget.reserve(OTHER, 60)).toThrowError(/too large to open/)
    release()
    // A read releases once; a second call must not return the reservation twice.
    release()
    // Once the first read finished, the same second read fits again.
    expect(() => budget.reserve(OTHER, 60)).not.toThrow()
  })

  it('refuses an estimate past its share of the free heap', () => {
    freeHeap(1000)
    const budget = new ColdOpenBudget(0.5, 8)
    expect(() => budget.reserve(sessionId, 100)).toThrowError(
      'session "cold" is too large to open: about 800 B of heap for 100 B stored, but only 1000 B of heap is free; close other Sessions or restart the host with a larger heap',
    )
  })
})
