/**
 * Opening the Investigate / Review chat for one item, through the host's chat
 * launcher (`lib/agentSession.ts`).
 *
 * The built-in's suites for this hook (`agentSessionConcludedNoRerun`,
 * `agentSessionResumeMissingSlot`, `agentSessionFolderResolve`,
 * `agentSessionSeedReceipt`, `IssueRadarSessionTitle`) drove the dashboard's Redux
 * slot thunks, chat folders and seed transport, none of which an installed app can
 * reach (PORTING.md, "UI"). The rules those suites pinned that this copy still
 * owns are pinned here, case for case:
 *
 * - a live recorded session is RESUMED (probe first; a failed probe is an error,
 *   never "gone");
 * - a CONCLUDED item whose session is gone is not silently re-run: the click is
 *   declined, a second explicit click (`force`) starts over, a status this build
 *   has never seen is treated as concluded, an absent status is not;
 * - the decision reads a FRESH record, and a failed re-read surfaces rather than
 *   guessing;
 * - a replacement session the record already names is reattached, not duplicated;
 * - a fresh session marks the record before the chat opens, never clears the
 *   stored verdict, and opens nothing when that write fails;
 * - GitLab merge requests use their own record namespace (`kind: 'pull'`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { stubNavigate, stubOpenChat } from '../stubs/app-sdk'

const { saveInvestigation, getInvestigation, liveSlots } = vi.hoisted(() => ({
  saveInvestigation: vi.fn(),
  getInvestigation: vi.fn(),
  liveSlots: vi.fn(),
}))

vi.mock('../../src/api', () => ({ issueRadarApi: { saveInvestigation, getInvestigation } }))
vi.mock('../../src/pipeline/api', () => ({ autoTriagePipelineFoldApi: { liveSlots } }))

import { itemKey, useAgentSession, withWorkingCopy } from '../../src/lib/agentSession'
import type { InvestigationRecord } from '../../src/api'

const REPO = { host: 'github.com', owner: 'acme', repo: 'demo-repo', provider: 'github' } as never
const SLOT = 'slot-closed'

function record(over: Partial<InvestigationRecord> = {}): InvestigationRecord {
  return { slot_key: SLOT, status: 'investigating', ...over } as InvestigationRecord
}

async function open(args: {
  existing: InvestigationRecord | null
  force?: boolean
  kind?: 'issue' | 'pull'
}) {
  const { result } = renderHook(() => useAgentSession())
  let opened: InvestigationRecord | null | undefined
  await act(async () => {
    opened = await result.current.openSession({
      repoRef: REPO,
      number: 6014,
      kind: args.kind,
      title: '#6014 · something',
      prompt: 'seed prompt',
      existing: args.existing,
      force: args.force,
    })
  })
  return { result, opened }
}

beforeEach(() => {
  saveInvestigation.mockReset()
  getInvestigation.mockReset()
  liveSlots.mockReset()
  saveInvestigation.mockResolvedValue({ investigation: { status: 'investigating' } })
  getInvestigation.mockResolvedValue({ investigation: null })
  liveSlots.mockResolvedValue([])
})

describe('a fresh session', () => {
  it('marks the record investigating, then opens a draft with the seed prompt', async () => {
    const { opened, result } = await open({ existing: null })
    expect(saveInvestigation).toHaveBeenCalledWith(REPO, 6014, { status: 'investigating' }, 'issue')
    expect(stubOpenChat).toHaveBeenCalledWith({ message: 'seed prompt', memoryMode: 'persistent', sessionFolder: false })
    expect(saveInvestigation.mock.invocationCallOrder[0]).toBeLessThan(stubOpenChat.mock.invocationCallOrder[0])
    expect(opened).toEqual({ status: 'investigating' })
    expect(result.current.error).toBeNull()
  })

  it('opens no chat when the record cannot be written, and surfaces the failure', async () => {
    saveInvestigation.mockRejectedValue(new Error('store busy'))
    const { opened, result } = await open({ existing: null })
    expect(opened).toBeNull()
    expect(stubOpenChat).not.toHaveBeenCalled()
    expect(result.current.error?.message).toBe('store busy')
    expect(result.current.busy).toBe(false)
  })

  it('does not destroy the stored verdict when it starts a replacement run', async () => {
    await open({ existing: record({ status: 'resolved', slot_key: undefined }), force: true })
    const patch = saveInvestigation.mock.calls.at(-1)?.[2] as Record<string, unknown>
    expect(patch).toEqual({ status: 'investigating' })
    expect('findings' in patch).toBe(false)
  })

  it('keeps a merge request in its own record namespace', async () => {
    await open({ existing: null, kind: 'pull' })
    expect(saveInvestigation).toHaveBeenCalledWith(REPO, 6014, { status: 'investigating' }, 'pull')
  })
})

describe('resuming a recorded session', () => {
  it('reopens a live session instead of starting a second one', async () => {
    liveSlots.mockResolvedValue([{ key: SLOT }])
    saveInvestigation.mockResolvedValue({ investigation: record() })
    const { opened } = await open({ existing: record() })
    expect(liveSlots).toHaveBeenCalledWith([SLOT])
    expect(stubOpenChat).toHaveBeenCalledWith({ slotKey: SLOT })
    // Only the timestamp touch, never a status rewrite.
    expect(saveInvestigation).toHaveBeenCalledWith(REPO, 6014, {}, 'issue')
    expect(getInvestigation).not.toHaveBeenCalled()
    expect(opened).toEqual(record())
  })

  it('surfaces a failed liveness probe instead of treating the session as gone', async () => {
    liveSlots.mockRejectedValue(new Error('request failed with status 503'))
    const { result } = await open({ existing: record({ status: 'resolved' }) })
    expect(result.current.error?.message).toContain('503')
    expect(stubOpenChat).not.toHaveBeenCalled()
    expect(result.current.concludedFor).toBeNull()
  })

  it('reattaches to a replacement session the fresh record already names', async () => {
    getInvestigation.mockResolvedValue({ investigation: record({ slot_key: 'slot-replacement' }) })
    liveSlots.mockImplementation(async (keys: string[]) => (keys[0] === 'slot-replacement' ? [{ key: 'slot-replacement' }] : []))
    await open({ existing: record() })
    expect(stubOpenChat).toHaveBeenCalledTimes(1)
    expect(stubOpenChat).toHaveBeenCalledWith({ slotKey: 'slot-replacement' })
  })

  it('still replaces an INTERRUPTED investigation without asking', async () => {
    getInvestigation.mockResolvedValue({ investigation: record({ status: 'investigating' }) })
    const { result } = await open({ existing: record() })
    expect(result.current.concludedFor).toBeNull()
    expect(stubOpenChat).toHaveBeenCalledWith({ message: 'seed prompt', memoryMode: 'persistent', sessionFolder: false })
  })
})

describe('a concluded item is not silently re-run', () => {
  it('declines a resolved record whose session was closed, and returns the fresh record', async () => {
    const fresh = record({ status: 'resolved' })
    getInvestigation.mockResolvedValue({ investigation: fresh })
    const { result, opened } = await open({ existing: record({ status: 'resolved' }) })
    expect(result.current.concludedFor).toBe(itemKey(REPO, 6014))
    expect(opened).toEqual(fresh)
    expect(stubOpenChat).not.toHaveBeenCalled()
    expect(saveInvestigation).not.toHaveBeenCalled()
  })

  it('declines a record this copy opened, which names no session', async () => {
    getInvestigation.mockResolvedValue({ investigation: record({ status: 'resolved', slot_key: undefined }) })
    const { result } = await open({ existing: record({ status: 'resolved', slot_key: undefined }) })
    expect(liveSlots).not.toHaveBeenCalled()
    expect(result.current.concludedFor).toBe(itemKey(REPO, 6014))
    expect(stubOpenChat).not.toHaveBeenCalled()
  })

  it('also declines a status it has never seen, rather than assuming it may re-run', async () => {
    getInvestigation.mockResolvedValue({ investigation: record({ status: 'archived-later' as never }) })
    const { result } = await open({ existing: record() })
    expect(result.current.concludedFor).toBe(itemKey(REPO, 6014))
    expect(stubOpenChat).not.toHaveBeenCalled()
  })

  it('treats an absent status as unfinished work, not a verdict', async () => {
    getInvestigation.mockResolvedValue({ investigation: record({ status: undefined as never }) })
    const { result } = await open({ existing: record() })
    expect(result.current.concludedFor).toBeNull()
    expect(stubOpenChat).toHaveBeenCalledTimes(1)
  })

  it('declines on a verdict the cached record has not caught up with', async () => {
    getInvestigation.mockResolvedValue({ investigation: record({ status: 'resolved' }) })
    const { result } = await open({ existing: record({ status: 'investigating' }) })
    expect(result.current.concludedFor).toBe(itemKey(REPO, 6014))
    expect(stubOpenChat).not.toHaveBeenCalled()
  })

  it('surfaces a failed re-read instead of guessing the status', async () => {
    getInvestigation.mockRejectedValue(new Error('re-read failed'))
    const { result } = await open({ existing: record({ status: 'resolved' }) })
    expect(result.current.error?.message).toBe('re-read failed')
    expect(result.current.concludedFor).toBeNull()
    expect(stubOpenChat).not.toHaveBeenCalled()
  })

  it('starts over when the user asks a second time', async () => {
    getInvestigation.mockResolvedValue({ investigation: record({ status: 'resolved' }) })
    const { result } = await open({ existing: record({ status: 'resolved' }), force: true })
    expect(result.current.concludedFor).toBeNull()
    expect(stubOpenChat).toHaveBeenCalledWith({ message: 'seed prompt', memoryMode: 'persistent', sessionFolder: false })
  })

  it('scopes the decline to the item, so another item is not forced past the guard', async () => {
    getInvestigation.mockResolvedValue({ investigation: record({ status: 'resolved' }) })
    const { result } = await open({ existing: record({ status: 'resolved' }) })
    expect(result.current.concludedFor).not.toBe(itemKey(REPO, 6015))
    expect(result.current.concludedFor).not.toBe(itemKey(REPO, 6014, 'pull'))
  })
})

describe('the working copy', () => {
  it('names a configured working copy in the seed, since the launcher cannot set a cwd', async () => {
    const { result } = renderHook(() => useAgentSession())
    await act(async () => {
      await result.current.openSession({ repoRef: REPO, number: 1, title: 't', prompt: 'seed', existing: null, workspacePath: ' /srv/trail ' })
    })
    expect(stubOpenChat).toHaveBeenCalledWith(expect.objectContaining({
      message: "seed\n\nThe repository's local working copy is at `/srv/trail`: run your commands there.",
    }))
  })

  it('leaves the seed alone without one', () => {
    expect(withWorkingCopy('seed', '')).toBe('seed')
    expect(withWorkingCopy('seed')).toBe('seed')
  })
})

describe('the way to a closed transcript', () => {
  it('opens the chat with its Older Sessions pane', () => {
    const { result } = renderHook(() => useAgentSession())
    act(() => result.current.openOlderSessions())
    expect(stubNavigate).toHaveBeenCalledWith('/chat?history=1')
  })
})
