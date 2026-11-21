// The pure half of the chat link-preview card: which hovered URL names an issue
// or change request, how the app's `/ref` summary turns into the card's words,
// and the query that asks for it. Dependency-free (no React, no DOM, nothing
// from `src/` the page bundle shares): `main.ts` bundles it into a second, self-
// contained module that runs in the dashboard's sandboxed link-preview frame,
// where none of the host's modules exist.

/** The forges the manifest claims. A self-managed GitLab host is not claimed:
 *  `contributes.linkPreviews.hosts` is static, and the operator's allowlist is
 *  not. */
export type ForgeProvider = 'github' | 'gitlab'

export type RefKind = 'issue' | 'pull'

/** One issue or change request a hovered URL names, as `/ref` addresses it. */
export interface ForgeRef {
  provider: ForgeProvider
  host: string
  /** `owner` on GitHub; the whole namespace (`group/subgroup`) on GitLab, as the
   *  app's repo identity carries it. */
  owner: string
  repo: string
  number: number
  kind: RefKind
}

/** The same ceiling the backend puts on a number it will look up. */
const MAX_NUMBER = 1_000_000_000

const GITHUB_KIND: Record<string, RefKind> = { issues: 'issue', pull: 'pull', pulls: 'pull' }
const GITLAB_KIND: Record<string, RefKind> = { issues: 'issue', merge_requests: 'pull' }

function refNumber(segment: string | undefined): number | null {
  if (!segment || !/^\d{1,10}$/.test(segment)) return null
  const n = Number(segment)
  return n >= 1 && n <= MAX_NUMBER ? n : null
}

/**
 * The reference a hovered URL names, or null for any other URL on the claimed
 * hosts (a repo page, a file, a discussion, a user). Hosts match exactly:
 * `www.github.com` folds onto `github.com` as the page's own parser does, and
 * nothing else is folded, so a lookalike (`github.com.example.test`) never
 * parses. Query and fragment are ignored: they address the same item.
 */
export function parseForgeUrl(href: string): ForgeRef | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)
  if (host === 'github.com' || host === 'www.github.com') {
    if (segments.length !== 4) return null
    const kind = GITHUB_KIND[segments[2]]
    const number = refNumber(segments[3])
    if (!kind || number === null) return null
    return { provider: 'github', host: 'github.com', owner: segments[0], repo: segments[1], number, kind }
  }
  if (host === 'gitlab.com') {
    // `/{namespace...}/{project}/-/{issues|merge_requests}/{n}`: the dash marks
    // where the project path ends, so a nested namespace keeps every segment.
    const dash = segments.indexOf('-')
    if (dash < 2 || segments.length !== dash + 3) return null
    const kind = GITLAB_KIND[segments[dash + 1]]
    const number = refNumber(segments[dash + 2])
    if (!kind || number === null) return null
    return {
      provider: 'gitlab',
      host,
      owner: segments.slice(0, dash - 1).join('/'),
      repo: segments[dash - 1],
      number,
      kind,
    }
  }
  return null
}

/** The reference as a human writes it: `owner/repo#12`, `group/project!7`. */
export function refLabel(ref: ForgeRef): string {
  const sigil = ref.provider === 'gitlab' && ref.kind === 'pull' ? '!' : '#'
  return `${ref.owner}/${ref.repo}${sigil}${ref.number}`
}

/** `/ref`'s query for a reference. `provider` and `host` ride along so a GitLab
 *  reference is looked up on GitLab; the route defaults both to GitHub. */
export function refQuery(ref: ForgeRef): string {
  const q = new URLSearchParams({
    owner: ref.owner,
    repo: ref.repo,
    number: String(ref.number),
    provider: ref.provider,
    host: ref.host,
  })
  return `ref?${q.toString()}`
}

/** One cache key per item, so the same reference hovered twice costs one read. */
export function refKey(ref: ForgeRef): string {
  return `${ref.provider}:${ref.host}:${ref.owner}/${ref.repo}#${ref.number}`
}

/** The repo half of the key: `/ref` refuses a whole repo, not one number. */
export function repoKey(ref: ForgeRef): string {
  return `${ref.provider}:${ref.host}:${ref.owner}/${ref.repo}`
}

/** What `/ref` answers, the fields the card reads. */
export interface RefSummary {
  number: number
  title: string
  state: string
  state_reason: string | null
  author: string | null
  created_at: string
  updated_at: string
  comments: number
  is_pr: boolean
  draft: boolean
  merged_at: string | null
  labels: Array<{ name: string; color: string }>
}

export type Lifecycle = 'merged' | 'closed' | 'draft' | 'open' | 'not_planned'

/** Lifecycle of a referenced item, mirroring the page's `RefLink` card: a change
 *  request splits merged / closed-unmerged / draft, an issue splits completed /
 *  not planned. */
export function lifecycle(s: RefSummary): Lifecycle {
  if (s.is_pr) {
    if (s.merged_at) return 'merged'
    if (s.state === 'closed') return 'closed'
    if (s.draft) return 'draft'
    return 'open'
  }
  if (s.state === 'closed') return s.state_reason === 'not_planned' ? 'not_planned' : 'closed'
  return 'open'
}

/** The shape of a `/ref` answer this module accepts; anything else is a failed read. */
export function readSummary(body: unknown): RefSummary | null {
  if (!body || typeof body !== 'object') return null
  const s = (body as { summary?: unknown }).summary
  if (!s || typeof s !== 'object') return null
  const r = s as Record<string, unknown>
  if (typeof r.title !== 'string' || typeof r.state !== 'string') return null
  return {
    number: typeof r.number === 'number' ? r.number : 0,
    title: r.title,
    state: r.state,
    state_reason: typeof r.state_reason === 'string' ? r.state_reason : null,
    author: typeof r.author === 'string' ? r.author : null,
    created_at: typeof r.created_at === 'string' ? r.created_at : '',
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : '',
    comments: typeof r.comments === 'number' ? r.comments : 0,
    is_pr: r.is_pr === true,
    draft: r.draft === true,
    merged_at: typeof r.merged_at === 'string' ? r.merged_at : null,
    labels: Array.isArray(r.labels)
      ? r.labels
        .filter((l): l is { name: string; color: string } => !!l && typeof l === 'object' && typeof (l as { name?: unknown }).name === 'string')
        .map(l => ({ name: l.name, color: typeof l.color === 'string' ? l.color : '' }))
      : [],
  }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * `3 days ago`, or the date past a month. The frame is told no locale (the
 * dashboard sends it only the URL, the rect and the theme), so this is the one
 * place the card formats a date, in English, with the browser's own date form as
 * the fallback.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const diff = now - then
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) { const m = Math.floor(diff / MINUTE); return `${m} minute${m === 1 ? '' : 's'} ago` }
  if (diff < DAY) { const h = Math.floor(diff / HOUR); return `${h} hour${h === 1 ? '' : 's'} ago` }
  if (diff < 30 * DAY) { const d = Math.floor(diff / DAY); return `${d} day${d === 1 ? '' : 's'} ago` }
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
