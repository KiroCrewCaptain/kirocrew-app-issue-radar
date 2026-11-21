/**
 * The chat link-preview card as the dashboard's frame drives it: `activate(ctx)`
 * once, then `show` per hover with the URL and the show's card controls. A
 * connected repo's reference gets the summary; every other URL gets the address
 * alone; one `/ref` read serves two hovers of the same reference.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activate, CARD_WIDTH, LEAVE_GRACE_MS, type FrameCtx, type Provider, type ShowLink } from '../../../src/linkPreview/main'

const PR = 'https://github.com/kirodotdev/KiroCrew/pull/34176'
const RECT = { left: 100, top: 100, width: 80, height: 18 }

const SUMMARY = {
  owner: 'kirodotdev', repo: 'KiroCrew', provider: 'github', host: 'github.com', number: 34176, from_cache: false,
  summary: {
    number: 34176, title: 'feat(chat): show a link’s address when the pointer rests on it', state: 'closed',
    state_reason: null, url: PR, author: 'garohop', author_association: 'CONTRIBUTOR', created_at: '2026-11-09T18:00:00Z',
    updated_at: '2026-11-10T20:00:00Z', closed_at: '2026-11-10T20:00:00Z', comments: 6, is_pr: true, draft: false,
    merged_at: '2026-11-10T20:00:00Z', labels: [{ name: 'fork', color: 'ededed' }, { name: 'area: chat', color: 'c5def5' }],
  },
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A frame context whose `fetch` answers `/ref` from `answer`, recording every path. */
function frameCtx(answer: (path: string) => Response | Promise<Response>) {
  const paths: string[] = []
  const ctx: FrameCtx = {
    appName: 'issue-radar',
    theme: () => 'dark',
    fetch: vi.fn(async (path: string) => { paths.push(path); return answer(path) }),
  }
  return { ctx, paths }
}

function controls() {
  return {
    open: vi.fn(), close: vi.fn(), resize: vi.fn(), pin: vi.fn(), dragBy: vi.fn(), dock: vi.fn(),
  }
}

const settle = () => vi.advanceTimersByTimeAsync(0)
const card = () => document.body.querySelector('.rc') as HTMLElement
const text = (sel: string) => card().querySelector(sel)?.textContent ?? ''

let provider: Provider | null = null

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-11-21T12:00:00Z')) })
afterEach(() => { provider?.dispose(); provider = null; vi.useRealTimers() })

function show(p: Provider, url: string, c = controls()): ReturnType<typeof controls> {
  const link: ShowLink = { url, theme: 'dark', rect: RECT, card: c }
  p.show(link)
  return c
}

describe('a connected repo', () => {
  it('opens at once with the reference and the address, then fills the summary from one /ref read', async () => {
    const { ctx, paths } = frameCtx(() => json(SUMMARY))
    provider = activate(ctx)
    expect(paths).toEqual([])

    const c = show(provider, PR)
    // Header and footer before any answer; the body shimmers.
    expect(text('.rc-head')).toBe('kirodotdev/KiroCrew#34176')
    expect(text('.rc-foot')).toBe(PR)
    expect(card().querySelectorAll('.rc-shimmer').length).toBe(3)
    expect(c.open).toHaveBeenCalledTimes(1)
    expect(c.resize).toHaveBeenCalledWith(expect.objectContaining({ width: CARD_WIDTH }))
    expect(paths).toEqual(['ref?owner=kirodotdev&repo=KiroCrew&number=34176&provider=github&host=github.com'])

    await settle()
    expect(card().querySelectorAll('.rc-shimmer').length).toBe(0)
    expect(text('.rc-row')).toContain('Merged')
    expect(text('.rc-row')).toContain('Pull request')
    expect(text('.rc-item-title')).toBe(SUMMARY.summary.title)
    expect(text('.rc-by')).toBe('garohop · opened 11 days ago')
    expect(text('.rc-labels')).toBe('forkarea: chat')
    expect(text('.rc-meta')).toContain('6')
    expect(text('.rc-meta')).toContain('updated 10 days ago')
    expect(text('.rc-foot')).toBe(PR)
    // The size is reported again once the body landed.
    expect(c.resize).toHaveBeenCalledTimes(2)
    expect(card().querySelector('a, button, [tabindex]')).toBeNull()
  })

  it('serves a second hover of the same reference from memory', async () => {
    const { ctx, paths } = frameCtx(() => json(SUMMARY))
    provider = activate(ctx)
    show(provider, PR)
    await settle()
    provider.hide('scroll')

    const c = show(provider, `${PR}#issuecomment-1`)
    expect(paths.length).toBe(1)
    expect(card().querySelectorAll('.rc-shimmer').length).toBe(0)
    expect(text('.rc-item-title')).toBe(SUMMARY.summary.title)
    expect(text('.rc-foot')).toBe(`${PR}#issuecomment-1`)
    expect(c.open).toHaveBeenCalledTimes(1)
  })

  it('answers a slower read for an earlier hover to nobody', async () => {
    let release: (r: Response) => void = () => {}
    const slow = new Promise<Response>(r => { release = r })
    const { ctx } = frameCtx(path => (path.includes('34176') ? slow : json({ ...SUMMARY, summary: { ...SUMMARY.summary, number: 1, title: 'Second' } })))
    provider = activate(ctx)
    const first = show(provider, PR)
    provider.leave()
    const second = show(provider, 'https://github.com/kirodotdev/KiroCrew/issues/1')
    await settle()
    expect(text('.rc-item-title')).toBe('Second')
    release(json(SUMMARY))
    await settle()
    expect(text('.rc-item-title')).toBe('Second')
    expect(first.resize).toHaveBeenCalledTimes(1)
    expect(second.resize).toHaveBeenCalledTimes(2)
  })
})

describe('a URL the card cannot enrich', () => {
  it('shows the address alone for a repo Issue Radar has not connected, and asks once per repo', async () => {
    const { ctx, paths } = frameCtx(() => json({ error: 'o/r is not connected — call /connect first' }, 404))
    provider = activate(ctx)
    show(provider, 'https://github.com/o/r/issues/5')
    await settle()
    expect(text('.rc-head')).toBe('o/r#5')
    expect(text('.rc-foot')).toBe('https://github.com/o/r/issues/5')
    expect(card().querySelector('.rc-body')?.childElementCount).toBe(0)

    provider.hide('escape')
    show(provider, 'https://github.com/o/r/pull/6')
    expect(paths.length).toBe(1)
    expect(card().querySelectorAll('.rc-shimmer').length).toBe(0)
    expect(text('.rc-foot')).toBe('https://github.com/o/r/pull/6')
  })

  it('shows the address alone when the read fails, and asks again after a minute', async () => {
    const { ctx, paths } = frameCtx(() => json({ error: 'upstream' }, 502))
    provider = activate(ctx)
    show(provider, PR)
    await settle()
    expect(card().querySelector('.rc-body')?.childElementCount).toBe(0)
    expect(text('.rc-foot')).toBe(PR)

    provider.hide('blur')
    show(provider, PR)
    expect(paths.length).toBe(1)
    vi.setSystemTime(Date.parse('2026-11-21T12:01:01Z'))
    provider.hide('blur')
    show(provider, PR)
    expect(paths.length).toBe(2)
  })

  it('shows the host and the address, with no read, for another page on the forge', () => {
    const { ctx, paths } = frameCtx(() => json(SUMMARY))
    provider = activate(ctx)
    const c = show(provider, 'https://github.com/kirodotdev/KiroCrew/blob/main/README.md')
    expect(paths).toEqual([])
    expect(text('.rc-head')).toBe('github.com')
    expect(text('.rc-foot')).toBe('https://github.com/kirodotdev/KiroCrew/blob/main/README.md')
    expect(card().querySelector('.rc-body')?.childElementCount).toBe(0)
    expect(c.open).toHaveBeenCalledTimes(1)
  })

  it('closes a show that carries no URL: the manifest declares no text patterns', () => {
    const { ctx } = frameCtx(() => json(SUMMARY))
    provider = activate(ctx)
    const c = controls()
    provider.show({ text: 'KC-1', theme: 'dark', rect: RECT, card: c })
    expect(c.open).not.toHaveBeenCalled()
    expect(c.close).toHaveBeenCalledTimes(1)
  })
})

describe('leaving and hiding', () => {
  it('closes after the leave grace unless the pointer crossed into the card', () => {
    const { ctx } = frameCtx(() => json(SUMMARY))
    provider = activate(ctx)
    const c = show(provider, PR)

    provider.leave()
    vi.advanceTimersByTime(LEAVE_GRACE_MS - 1)
    expect(c.close).not.toHaveBeenCalled()
    card().dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(LEAVE_GRACE_MS * 2)
    expect(c.close).not.toHaveBeenCalled()

    card().dispatchEvent(new MouseEvent('mouseleave'))
    expect(c.close).toHaveBeenCalledTimes(1)
  })

  it('closes at once on hide, follows the theme, and leaves nothing behind on dispose', () => {
    const { ctx } = frameCtx(() => json(SUMMARY))
    provider = activate(ctx)
    const c = show(provider, PR)
    expect(card().dataset.theme).toBe('dark')
    provider.theme('light')
    expect(card().dataset.theme).toBe('light')
    provider.hide('scroll')
    expect(c.close).toHaveBeenCalledTimes(1)
    provider.dispose()
    provider = null
    expect(document.body.querySelector('.rc')).toBeNull()
  })
})
