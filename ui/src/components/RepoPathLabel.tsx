/** Left-to-right mark, U+200E. See RepoPathLabel. */
const LRM = '\u200E'

/** One repo path, rendered repo-name-first: the owner/group path is muted and
 * truncates from the LEFT (ellipsis prefix), the repo name never gives up its
 * width to the owner path.
 *
 * Why: GitLab nests groups arbitrarily deep (`acme/infra/cloud/modules/…`), and
 * with plain right-side truncation every repo under the same parent group
 * renders identically — the distinguishing repo name is exactly the part that
 * gets cut off (#3047). Left-truncation keeps the tail of the group path (the
 * most specific part) and the whole repo name visible.
 *
 * Mechanics: the owner span is `dir="rtl"`, which moves its CSS ellipsis to the
 * left edge; LRM (U+200E) sentinels keep the characters themselves in logical
 * order when the path starts or ends on a neutral/weak character (digits, `-`).
 * Each sentinel sits in its own `aria-hidden` + `select-none` span, so it still
 * participates in bidi resolution but never lands in a text selection, the
 * clipboard, or the accessible name. The owner span carries a huge flex-shrink
 * and a zero min-width so it absorbs ALL width pressure before the repo span
 * (plain `truncate`) gives up a single pixel. Deliberately NO min-width floor
 * on the owner span: a floor only takes effect when the repo name already
 * needs every pixel, so it would re-truncate the repo name (the #3047 defect)
 * to show an ellipsis that carries less information than the repo characters
 * it displaced — verified empirically at 288px with this issue's repro paths.
 * When the owner collapses fully, the leading `/` on the repo span still
 * signals a dropped prefix, and the full path stays one hover away in `title`.
 */
export default function RepoPathLabel({
  owner, repo, className = '', repoClassName = '',
}: {
  owner: string
  repo: string
  className?: string
  repoClassName?: string
}) {
  return (
    <span
      className={`min-w-0 flex items-baseline ${className}`}
      title={`${owner}/${repo}`}
      data-testid="repo-path-label"
    >
      <span dir="rtl" className="min-w-0 [flex-shrink:9999] truncate text-muted font-normal">
        <span aria-hidden="true" className="select-none">{LRM}</span>
        {owner}
        <span aria-hidden="true" className="select-none">{LRM}</span>
      </span>
      <span className={`min-w-0 truncate ${repoClassName}`}>/{repo}</span>
    </span>
  )
}

