// The chat link-preview card (`contributes.linkPreviews`, id `ref-card`).
//
// The dashboard loads this module in a sandboxed frame the first time a chat link
// on one of the manifest's hosts is hovered, calls `activate(ctx)` once, then
// `show` per hover with the URL and `leave` / `hide` as the pointer moves on. It
// owns the 300 ms hover delay, the placement and the dismissal; this module owns
// only what is in the card. `ctx.fetch` reaches this app's own routes and nothing
// else, so the card is fed by the same `GET /ref` the page's `RefLink` hover card
// uses, and the same connected-repo rule holds: a repo not connected in Issue
// Radar answers 404 and gets no summary.
//
// Every URL the dashboard hands over gets a card, because the address bubble the
// dashboard shows for an ordinary link steps aside for an app's card: a URL this
// module cannot enrich (not an issue or change-request path, a repo that is not
// connected, a failed read) still shows that address in the footer, so the
// reader sees where a link goes before clicking it. The address is the one the
// dashboard hands over: origin and path, without the query or the fragment (the
// host's default; `fullUrl` is not asked for). Clicks never reach this frame: the
// link stays the browser's.
//
// No host module exists in the frame (no React, no SDK, no catalogs), so the card
// is plain DOM and its words are English; the frame is not told the dashboard's
// language either.
import {
  lifecycle, parseForgeUrl, readSummary, refKey, refLabel, refQuery, relativeTime, repoKey,
  type ForgeRef, type Lifecycle, type RefSummary,
} from './refCard'

/** The card's width, the page's `RefLink` card width. */
export const CARD_WIDTH = 340
/** How long a pointer that left the link may take to cross into the card. */
export const LEAVE_GRACE_MS = 200
/** How long a summary is reused across hovers; the server keeps its own, shorter TTL. */
export const SUMMARY_TTL_MS = 5 * 60_000
/** How long a repo `/ref` refused stays address-only, so one unconnected repo is
 *  not asked about on every hover. */
export const REFUSED_TTL_MS = 10 * 60_000
/** How long any other failed read is remembered. */
export const FAILED_TTL_MS = 60_000
/** How many `/ref` reads may be in flight at once. Each is a provider call under
 *  the owner's credential, so a sweep across many references in one message is
 *  bounded here as well as by the host's hover delay; a hover past the cap shows
 *  the address alone and asks again next time. */
export const MAX_INFLIGHT = 4
/** Labels shown before the rest fold into a count. */
const LABELS_SHOWN = 4

type Theme = 'dark' | 'light'

interface Rect { left: number; top: number; width: number; height: number }

interface CardControls {
  open(): void
  close(): void
  resize(size: { width: number; height: number }): void
  pin(pinned: boolean): void
  dragBy(dx: number, dy: number): void
  dock(edge: 'left' | 'right' | null): void
}

export interface ShowLink {
  url?: string
  text?: string
  theme: Theme
  rect: Rect
  card: CardControls
}

export interface FrameCtx {
  appName: string
  theme(): Theme
  fetch(path: string, init?: RequestInit): Promise<Response>
}

export interface Provider {
  show(link: ShowLink): void
  leave(): void
  hide(reason: string): void
  theme(theme: Theme): void
  dispose(): void
}

type Cached =
  | { kind: 'summary'; summary: RefSummary; until: number }
  | { kind: 'failed'; until: number }

const LIFECYCLE_WORDS: Record<Lifecycle, string> = {
  merged: 'Merged',
  closed: 'Closed',
  draft: 'Draft',
  open: 'Open',
  not_planned: 'Closed as not planned',
}

/** Lucide's glyphs for the lifecycle row, as path data: the frame has no icon
 *  module. `tint` names a CSS variable of the card's own palette. */
const LIFECYCLE_GLYPH: Record<Lifecycle, { tint: string; parts: Array<[string, Record<string, string>]> }> = {
  merged: { tint: 'aim', parts: [['circle', { cx: '18', cy: '18', r: '3' }], ['circle', { cx: '6', cy: '6', r: '3' }], ['path', { d: 'M6 21V9a9 9 0 0 0 9 9' }]] },
  open: { tint: 'ok', parts: [['circle', { cx: '12', cy: '12', r: '10' }], ['circle', { cx: '12', cy: '12', r: '1' }]] },
  closed: { tint: 'muted', parts: [['circle', { cx: '12', cy: '12', r: '10' }], ['line', { x1: '9', x2: '15', y1: '15', y2: '9' }]] },
  not_planned: { tint: 'muted', parts: [['circle', { cx: '12', cy: '12', r: '10' }], ['line', { x1: '9', x2: '15', y1: '15', y2: '9' }]] },
  draft: { tint: 'muted', parts: [['circle', { cx: '18', cy: '18', r: '3' }], ['circle', { cx: '6', cy: '6', r: '3' }], ['path', { d: 'M18 6V5' }], ['path', { d: 'M18 11v-1' }], ['line', { x1: '6', x2: '6', y1: '9', y2: '21' }]] },
}
const OPEN_PR_GLYPH: Array<[string, Record<string, string>]> = [['circle', { cx: '18', cy: '18', r: '3' }], ['circle', { cx: '6', cy: '6', r: '3' }], ['path', { d: 'M13 6h3a2 2 0 0 1 2 2v7' }], ['line', { x1: '6', x2: '6', y1: '9', y2: '21' }]]
const CHECK_GLYPH: Array<[string, Record<string, string>]> = [['circle', { cx: '12', cy: '12', r: '10' }], ['path', { d: 'm9 12 2 2 4-4' }]]
const COMMENT_GLYPH: Array<[string, Record<string, string>]> = [['path', { d: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z' }]]

const STYLE = `
.rc, .rc * { box-sizing: border-box; }
.rc {
  --bg: #ffffff; --fg: #1f2328; --strong: #0b0f14; --muted: #6b7280; --border: #d0d7de;
  --ok: #1a7f37; --aim: #8250df; --code: #f3f4f6; --shimmer: rgba(107,114,128,.18); --sweep: rgba(130,80,223,.18);
  width: ${CARD_WIDTH}px; max-width: 100vw; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--fg);
  font: 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; overflow: hidden;
}
.rc[data-theme="dark"] {
  --bg: #171b22; --fg: #d1d7e0; --strong: #f0f3f6; --muted: #8b949e; --border: #30363d;
  --ok: #3fb950; --aim: #a371f7; --code: #0f1217; --shimmer: rgba(139,148,158,.18); --sweep: rgba(163,113,247,.22);
}
.rc-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--border); font-weight: 600; color: var(--strong); }
.rc-head .rc-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-body { padding: 8px 10px; }
.rc-body:empty { display: none; }
.rc-row { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.rc-row svg, .rc-meta svg { width: 14px; height: 14px; flex: none; }
.rc-tint-ok { color: var(--ok); } .rc-tint-aim { color: var(--aim); } .rc-tint-muted { color: var(--muted); }
.rc-item-title { margin-top: 4px; font-weight: 500; line-height: 1.35; color: var(--strong); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.rc-by { margin-top: 6px; color: var(--muted); } .rc-by b { font-weight: 500; color: var(--fg); }
.rc-labels { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.rc-label { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--border); border-radius: 999px; padding: 0 6px; font-size: 11px; line-height: 16px; color: var(--muted); }
.rc-label i { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.rc-meta { display: flex; gap: 12px; margin-top: 6px; color: var(--muted); }
.rc-meta span { display: inline-flex; align-items: center; gap: 4px; }
.rc-foot { padding: 6px 10px; border-top: 1px solid var(--border); font: 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); overflow-wrap: anywhere; }
.rc-shimmer { height: 12px; border-radius: 4px; background: var(--shimmer); position: relative; overflow: hidden; margin: 4px 0; }
.rc-shimmer::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--sweep), transparent); background-size: 200% 100%; animation: rc-sweep 1.4s linear infinite; }
@keyframes rc-sweep { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .rc-shimmer::after { animation: none; } }
`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function glyph(parts: Array<[string, Record<string, string>]>, cls: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', cls)
  for (const [name, attrs] of parts) {
    const part = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, v)
    svg.appendChild(part)
  }
  return svg
}

/** The lifecycle row's glyph: the open change request has its own, and a closed
 *  issue that was completed shows the check. */
function lifecycleGlyph(life: Lifecycle, s: RefSummary): SVGSVGElement {
  const { tint, parts } = LIFECYCLE_GLYPH[life]
  if (s.is_pr && life === 'open') return glyph(OPEN_PR_GLYPH, `rc-tint-${tint}`)
  if (!s.is_pr && life === 'closed') return glyph(CHECK_GLYPH, 'rc-tint-aim')
  return glyph(parts, `rc-tint-${tint}`)
}

/** The summary body, the page's `RefLink` card body in plain DOM. */
export function summaryBody(s: RefSummary): HTMLElement[] {
  const life = lifecycle(s)
  const row = el('div', 'rc-row')
  row.appendChild(lifecycleGlyph(life, s))
  const word = el('span', `rc-tint-${LIFECYCLE_GLYPH[life].tint}`, LIFECYCLE_WORDS[life])
  if (!s.is_pr && life === 'closed') word.className = 'rc-tint-aim'
  row.appendChild(word)
  row.appendChild(el('span', undefined, s.is_pr ? 'Pull request' : 'Issue'))
  const out: HTMLElement[] = [row, el('div', 'rc-item-title', s.title)]
  const by = el('div', 'rc-by')
  if (s.author) {
    by.appendChild(el('b', undefined, s.author))
    by.appendChild(document.createTextNode(' · '))
  }
  by.appendChild(document.createTextNode(`opened ${relativeTime(s.created_at)}`))
  out.push(by)
  if (s.labels.length) {
    const labels = el('div', 'rc-labels')
    for (const l of s.labels.slice(0, LABELS_SHOWN)) {
      const chip = el('span', 'rc-label')
      const dot = el('i')
      if (/^[0-9a-f]{6}$/i.test(l.color)) dot.style.background = `#${l.color}`
      chip.appendChild(dot)
      chip.appendChild(document.createTextNode(l.name))
      labels.appendChild(chip)
    }
    const more = s.labels.length - LABELS_SHOWN
    if (more > 0) labels.appendChild(el('span', 'rc-label', `+${more}`))
    out.push(labels)
  }
  const meta = el('div', 'rc-meta')
  const comments = el('span')
  comments.appendChild(glyph(COMMENT_GLYPH, ''))
  comments.appendChild(document.createTextNode(String(s.comments)))
  comments.setAttribute('aria-label', `${s.comments} comments`)
  meta.appendChild(comments)
  if (s.updated_at) meta.appendChild(el('span', undefined, `updated ${relativeTime(s.updated_at)}`))
  out.push(meta)
  return out
}

function shimmerBody(): HTMLElement[] {
  return ['42%', '88%', '56%'].map(w => { const bar = el('div', 'rc-shimmer'); bar.style.width = w; return bar })
}

/** One card: the DOM it owns and the show it is answering. */
class RefCard {
  readonly root = el('div', 'rc')
  private readonly head = el('div', 'rc-head')
  private readonly title = el('span', 'rc-title')
  private readonly body = el('div', 'rc-body')
  private readonly foot = el('div', 'rc-foot')
  private current: { card: CardControls; seq: number } | null = null
  private seq = 0
  private closeTimer: ReturnType<typeof setTimeout> | undefined
  private overCard = false
  private readonly cache = new Map<string, Cached>()
  private readonly inflight = new Map<string, Promise<Cached>>()

  constructor(private readonly ctx: FrameCtx, private readonly now: () => number = Date.now) {
    const style = el('style')
    style.textContent = STYLE
    this.root.appendChild(style)
    this.head.appendChild(this.title)
    this.root.appendChild(this.head)
    this.root.appendChild(this.body)
    this.root.appendChild(this.foot)
    this.root.dataset.theme = ctx.theme()
    this.root.addEventListener('mouseenter', () => { this.overCard = true; this.cancelClose() })
    this.root.addEventListener('mouseleave', () => { this.overCard = false; this.close() })
  }

  setTheme(theme: Theme): void { this.root.dataset.theme = theme }

  show(link: ShowLink): void {
    this.cancelClose()
    const seq = ++this.seq
    this.current = { card: link.card, seq }
    this.root.dataset.theme = link.theme
    const url = link.url
    if (!url) { link.card.close(); this.current = null; return }
    const ref = parseForgeUrl(url)
    this.foot.textContent = url
    this.body.replaceChildren()
    if (!ref) {
      // Not an issue or change request: the address alone, under the host.
      this.title.textContent = hostOf(url)
      this.publish(link.card)
      return
    }
    this.title.textContent = refLabel(ref)
    const cached = this.fresh(refKey(ref)) ?? this.fresh(repoKey(ref))
    if (cached) {
      this.fill(cached)
      this.publish(link.card)
      return
    }
    this.body.replaceChildren(...shimmerBody())
    this.publish(link.card)
    void this.load(ref).then(result => {
      // A slower answer for an earlier hover: the dashboard would drop its card
      // calls anyway, and the DOM now shows another link's card.
      if (this.current?.seq !== seq) return
      this.fill(result)
      this.publish(link.card)
    })
  }

  leave(): void {
    if (this.overCard) return
    this.cancelClose()
    this.closeTimer = setTimeout(() => this.close(), LEAVE_GRACE_MS)
  }

  hide(): void { this.cancelClose(); this.close() }

  private close(): void {
    this.cancelClose()
    const cur = this.current
    this.current = null
    cur?.card.close()
  }

  private cancelClose(): void {
    if (this.closeTimer !== undefined) { clearTimeout(this.closeTimer); this.closeTimer = undefined }
  }

  /** Report the card's size and open it; after the body changes, report again. */
  private publish(card: CardControls): void {
    card.resize({ width: CARD_WIDTH, height: this.root.offsetHeight || this.root.getBoundingClientRect().height })
    card.open()
  }

  private fill(result: Cached): void {
    // A failed read leaves no body: the header and the address already say what
    // the link is, and a repeated "couldn't load" would only add noise.
    this.body.replaceChildren(...(result.kind === 'summary' ? summaryBody(result.summary) : []))
  }

  private fresh(key: string): Cached | null {
    const hit = this.cache.get(key)
    if (!hit) return null
    if (hit.until <= this.now()) { this.cache.delete(key); return null }
    return hit
  }

  /** One request per item, shared by concurrent hovers of the same reference,
   *  and at most `MAX_INFLIGHT` items at once. */
  private load(ref: ForgeRef): Promise<Cached> {
    const key = refKey(ref)
    let p = this.inflight.get(key)
    if (!p) {
      // Over the cap: nothing is remembered, so the next hover asks.
      if (this.inflight.size >= MAX_INFLIGHT) return Promise.resolve({ kind: 'failed', until: this.now() })
      p = this.fetchSummary(ref).finally(() => this.inflight.delete(key))
      this.inflight.set(key, p)
    }
    return p
  }

  private async fetchSummary(ref: ForgeRef): Promise<Cached> {
    const now = this.now()
    try {
      const res = await this.ctx.fetch(refQuery(ref))
      if (res.status === 404) {
        // The repo is not connected in Issue Radar: the repo is the unit the
        // route refuses, so the whole repo stays address-only for a while. (A
        // number that does not exist is the provider's error, a 502, remembered
        // below for the one item.)
        const refused: Cached = { kind: 'failed', until: now + REFUSED_TTL_MS }
        this.cache.set(repoKey(ref), refused)
        return refused
      }
      if (!res.ok) throw new Error(`ref ${res.status}`)
      const summary = readSummary(await res.json())
      if (!summary) throw new Error('ref: unexpected body')
      const hit: Cached = { kind: 'summary', summary, until: now + SUMMARY_TTL_MS }
      this.cache.set(refKey(ref), hit)
      return hit
    } catch {
      const failed: Cached = { kind: 'failed', until: now + FAILED_TTL_MS }
      this.cache.set(refKey(ref), failed)
      return failed
    }
  }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

/** The frame's entry: called once by the dashboard's link-preview bootstrap. */
export function activate(ctx: FrameCtx): Provider {
  const card = new RefCard(ctx)
  document.body.appendChild(card.root)
  return {
    show: link => card.show(link),
    leave: () => card.leave(),
    hide: () => card.hide(),
    theme: theme => card.setTheme(theme),
    dispose: () => card.root.remove(),
  }
}

declare global {
  /** The dashboard's frame bootstrap, present only where it runs the module
   *  inline (behind an authenticating proxy that refuses the frame's own import);
   *  there no export can be read, so `activate` is handed over through it. */
  // eslint-disable-next-line no-var
  var kirocrew: { register?: (activate: (ctx: FrameCtx) => Provider) => void } | undefined
}

globalThis.kirocrew?.register?.(activate)
