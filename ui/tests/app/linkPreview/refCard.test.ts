/**
 * The pure half of the chat link-preview card: which hovered URL names an issue
 * or change request, the `/ref` query for it, and how a summary reads.
 */
import { describe, expect, it } from 'vitest'
import {
  lifecycle, parseForgeUrl, readSummary, refKey, refLabel, refQuery, relativeTime, repoKey, type RefSummary,
} from '../../../src/linkPreview/refCard'

const summary = (over: Partial<RefSummary> = {}): RefSummary => ({
  number: 34176, title: 'feat(chat): show a link’s address', state: 'open', state_reason: null, author: 'someone',
  created_at: '2026-11-09T18:00:00Z', updated_at: '2026-11-10T20:00:00Z', comments: 3, is_pr: false, draft: false,
  merged_at: null, labels: [], ...over,
})

describe('parseForgeUrl', () => {
  it('reads a GitHub issue, pull and pulls path, ignoring query and fragment', () => {
    expect(parseForgeUrl('https://github.com/kirodotdev/KiroCrew/pull/34176')).toEqual(
      { provider: 'github', host: 'github.com', owner: 'kirodotdev', repo: 'KiroCrew', number: 34176, kind: 'pull' },
    )
    expect(parseForgeUrl('https://github.com/o/r/issues/7?x=1#issuecomment-9')?.kind).toBe('issue')
    expect(parseForgeUrl('https://github.com/o/r/pulls/7')?.kind).toBe('pull')
    expect(parseForgeUrl('https://www.github.com/o/r/issues/7')?.host).toBe('github.com')
  })

  it('reads a GitLab issue and merge request, keeping subgroups in the owner', () => {
    expect(parseForgeUrl('https://gitlab.com/group/sub/project/-/merge_requests/12')).toEqual(
      { provider: 'gitlab', host: 'gitlab.com', owner: 'group/sub', repo: 'project', number: 12, kind: 'pull' },
    )
    expect(parseForgeUrl('https://gitlab.com/group/project/-/issues/3')).toEqual(
      { provider: 'gitlab', host: 'gitlab.com', owner: 'group', repo: 'project', number: 3, kind: 'issue' },
    )
  })

  it('names nothing for another page on the forge, a lookalike host, a credential, http or a self-managed host', () => {
    for (const href of [
      'https://github.com/kirodotdev/KiroCrew',
      'https://github.com/kirodotdev/KiroCrew/blob/main/README.md',
      'https://github.com/kirodotdev/KiroCrew/pull/34176/files',
      'https://github.com/kirodotdev/KiroCrew/discussions/5',
      'https://github.com/o/r/issues/0',
      'https://github.com/o/r/issues/12345678901',
      'https://github.com.example.test/o/r/issues/1',
      'https://evil-github.com/o/r/issues/1',
      'https://user:pw@github.com/o/r/issues/1',
      'https://github.com:8443/o/r/issues/1',
      'http://github.com/o/r/issues/1',
      'https://gitlab.com/group/project/issues/3',
      'https://gitlab.com/-/issues/3',
      'https://gitlab.example.com/group/project/-/issues/3',
      'not a url',
    ]) {
      expect(parseForgeUrl(href), href).toBeNull()
    }
  })
})

describe('labels, keys and the /ref query', () => {
  const gh = parseForgeUrl('https://github.com/kirodotdev/KiroCrew/pull/34176')!
  const gl = parseForgeUrl('https://gitlab.com/group/sub/project/-/merge_requests/12')!

  it('writes the reference the way its forge does', () => {
    expect(refLabel(gh)).toBe('kirodotdev/KiroCrew#34176')
    expect(refLabel(gl)).toBe('group/sub/project!12')
    expect(refLabel(parseForgeUrl('https://gitlab.com/group/project/-/issues/3')!)).toBe('group/project#3')
  })

  it('asks /ref with the provider and host, relative to the app routes', () => {
    expect(refQuery(gh)).toBe('ref?owner=kirodotdev&repo=KiroCrew&number=34176&provider=github&host=github.com')
    expect(refQuery(gl)).toBe('ref?owner=group%2Fsub&repo=project&number=12&provider=gitlab&host=gitlab.com')
  })

  it('keys one item and one repo', () => {
    expect(refKey(gh)).toBe('github:github.com:kirodotdev/KiroCrew#34176')
    expect(repoKey(gh)).toBe('github:github.com:kirodotdev/KiroCrew')
    expect(repoKey(parseForgeUrl('https://github.com/kirodotdev/KiroCrew/issues/1')!)).toBe(repoKey(gh))
  })
})

describe('lifecycle', () => {
  it('splits a change request into merged, closed, draft and open', () => {
    expect(lifecycle(summary({ is_pr: true, merged_at: '2026-11-10T20:00:00Z', state: 'closed' }))).toBe('merged')
    expect(lifecycle(summary({ is_pr: true, state: 'closed' }))).toBe('closed')
    expect(lifecycle(summary({ is_pr: true, draft: true }))).toBe('draft')
    expect(lifecycle(summary({ is_pr: true }))).toBe('open')
  })

  it('splits an issue into completed, not planned and open', () => {
    expect(lifecycle(summary({ state: 'closed' }))).toBe('closed')
    expect(lifecycle(summary({ state: 'closed', state_reason: 'not_planned' }))).toBe('not_planned')
    expect(lifecycle(summary())).toBe('open')
  })
})

describe('readSummary', () => {
  it('reads the fields the card shows and drops a malformed label', () => {
    const read = readSummary({ summary: { ...summary(), labels: [{ name: 'bug', color: 'd73a4a' }, { color: 'x' }, null] } })
    expect(read?.title).toBe('feat(chat): show a link’s address')
    expect(read?.labels).toEqual([{ name: 'bug', color: 'd73a4a' }])
  })

  it('refuses a body without a summary, or one missing its title or state', () => {
    expect(readSummary(null)).toBeNull()
    expect(readSummary({ error: 'not connected' })).toBeNull()
    expect(readSummary({ summary: { title: 'x' } })).toBeNull()
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-11-21T12:00:00Z')
  it('counts minutes, hours and days, and falls back to a date past a month', () => {
    expect(relativeTime('2026-11-21T11:59:40Z', now)).toBe('just now')
    expect(relativeTime('2026-11-21T11:30:00Z', now)).toBe('30 minutes ago')
    expect(relativeTime('2026-11-21T11:00:00Z', now)).toBe('1 hour ago')
    expect(relativeTime('2026-11-18T12:00:00Z', now)).toBe('3 days ago')
    expect(relativeTime('2026-09-01T12:00:00Z', now)).toMatch(/2026/)
    expect(relativeTime('nope', now)).toBe('')
  })
})
