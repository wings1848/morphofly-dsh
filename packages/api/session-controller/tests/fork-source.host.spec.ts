/** Remote fork failures release any Agent created during setup. @module */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import * as persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestRemote } from './test-remote.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-remote-fork-source-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(persistence, { root, compression: 'none' })
  const harness = await mountAgentLoopTestHarness(ctx)
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('parent reply')]))
  ctx.provide('workspaceRegistry', { list: () => [], archivedSessionIds: [] } as never)
  const parent = await harness.create(SessionId('source'), { provider: 'mock', model: 'mock' })
  parent.followup(createUserMessage({ content: [{ type: 'text', text: 'parent history' }], source: { kind: 'user' } }))
  await parent.whenIdle()
  await ctx.sessions.flush(parent.session)
  const remote = await createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), cwd: tmpdir() })
  return { ctx, parent, remote }
}

it('releases child storage when the creation setup fails', async () => {
  const { ctx, parent, remote } = await fixture()
  const failure = new Error('child setup failed')
  let childId: SessionIdType | undefined
  // oxlint-disable-next-line typescript/unbound-method -- Called with the consumer-traced registry below.
  const create = AgentRegistry.prototype.create
  const created = vi.spyOn(ctx.agents, 'create').mockImplementation(async function (this: AgentRegistry, options) {
    childId = options.sessionId
    expect(options.parentSource).toEqual({ sessionId: parent.id, endSeq: parent.session.seq })
    expect(options.seed).toEqual([...parent.session.snapshotEvents(), expect.objectContaining({ type: 'session/end-seed', seq: parent.session.seq })])
    return create.call(this, { ...options, setup: () => { throw failure } })
  })
  onTestFinished(() => { created.mockRestore() })
  const result = await remote.fork({ sessionId: parent.id })
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected failed Remote fork')
  expect(result.error.code).toBe('gateway/internal')
  expect(result.error.message).toContain(failure.message)
  expect(created).toHaveBeenCalledOnce()
  expect(ctx.agents.list().map(agent => agent.id)).toEqual([parent.id])
  if (childId === undefined) throw new Error('Expected fork identity')
  const stored = await ctx.sessionPersistence.open(childId, 'write')
  await stored.close()
})

it('publishes the identity requested from the creation factory', async () => {
  const { ctx, parent, remote } = await fixture()
  const created = vi.spyOn(ctx.agents, 'create')
  onTestFinished(() => { created.mockRestore() })
  const result = await remote.fork({ sessionId: parent.id })
  if (!result.ok) throw result.error
  expect(result.value.sessionId).toBe(created.mock.calls[0]?.[0].sessionId)
  expect(ctx.agents.get(result.value.sessionId)?.id).toBe(result.value.sessionId)
  expect(created).toHaveBeenCalledOnce()
})



it('keeps cold read repairs in the child segment when the parent continues before creation', async () => {
  const { ctx, remote } = await fixture()
  const parent = Session.create(SessionId('cold-parent'))
  parent.append('turn/start', { turn: 1 })
  const writer = await ctx.sessionPersistence.create(parent.header)
  try { await writer.append(parent.snapshotEvents()) } finally { await writer.close() }
  const create = ctx.sessionPersistence.create.bind(ctx.sessionPersistence)
  const creating = vi.spyOn(ctx.sessionPersistence, 'create').mockImplementation(async (header, options) => {
    expect(options?.parentSource).toMatchObject({ sessionId: parent.id, endSeq: 1 })
    expect(options?.parentSource?.events).toMatchObject([
      { type: 'turn/start', seq: 0 },
      { type: 'turn/end', seq: 1, data: { reason: { kind: 'interrupted' } } },
      { type: 'session/end-seed', seq: 2, data: { inherited: true } },
    ])
    const parentWriter = await ctx.sessionPersistence.open(parent.id, 'write')
    try {
      await parentWriter.append([{ type: 'turn/end', seq: SessionSeq(1), time: 2,
        data: { turn: 1, reason: { kind: 'completed' } } }])
    } finally { await parentWriter.close() }
    return create(header, options)
  })
  onTestFinished(() => { creating.mockRestore() })
  const result = await remote.fork({ sessionId: parent.id })
  if (!result.ok) throw result.error
  const child = ctx.sessions.get(result.value.sessionId)
  expect(child?.snapshotEvents()).toMatchObject([
    { type: 'turn/start', seq: 0 },
    { type: 'turn/end', seq: 1, data: { reason: { kind: 'interrupted' } } },
    { type: 'session/end-seed', seq: 2, data: { inherited: true } },
  ])
  const reader = await ctx.sessionPersistence.open(result.value.sessionId, 'read')
  try { expect((await reader.read()).events).toEqual(child?.snapshotEvents()) } finally { await reader.close() }
})
