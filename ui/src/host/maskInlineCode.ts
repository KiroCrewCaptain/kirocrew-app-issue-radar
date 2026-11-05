/** `maskInlineCode` from the dashboard's `hooks/useBlockAssembler.ts`, restated: pure. */

/**
 * Mask inline-code regions within a single line.
 *
 * Returns a string of the same length as `line` where the contents of each
 * balanced backtick run (`` `...` ``, `` ``...`` ``, etc.) including the
 * delimiters themselves are replaced with space characters. Unbalanced runs
 * are left as-is by default. CommonMark inline code does not span newlines,
 * so a per-line mask is sufficient.
 *
 * Used to prevent widget tag detection from false-matching inside quoted
 * examples like `` `<mcwidget>...</mcwidget>` `` that an author wrote to
 * document the syntax.
 *
 * `streamingTrailingLine` (default false): when true, an unmatched opening
 * backtick run is treated as an inline-code span whose closing run has not
 * yet streamed in. Everything from the opening run to end-of-line is masked.
 * Only set this for the LAST line of a streaming buffer — for any line that
 * already has a newline after it the input is final and unmatched runs are
 * literal text per CommonMark.
 */
export function maskInlineCode(line: string, streamingTrailingLine = false): string {
  const out = line.split('')
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') { i++; continue }
    const runStart = i
    while (i < line.length && line[i] === '`') i++
    const runLen = i - runStart
    // Search forward for a backtick run of exactly the same length.
    let j = i
    let matchStart = -1
    while (j < line.length) {
      if (line[j] !== '`') { j++; continue }
      const r2Start = j
      while (j < line.length && line[j] === '`') j++
      if (j - r2Start === runLen) { matchStart = r2Start; break }
    }
    if (matchStart >= 0) {
      for (let k = runStart; k < matchStart + runLen; k++) out[k] = ' '
      i = matchStart + runLen
    } else if (streamingTrailingLine) {
      // Streaming: assume the closing run has not yet arrived. Mask the rest
      // of the line so any widget tag inside the (still-incomplete) span is
      // not falsely promoted to a widget. When the close arrives in the next
      // streaming snapshot the run is balanced and the normal branch above
      // takes over.
      for (let k = runStart; k < line.length; k++) out[k] = ' '
      i = line.length
    }
    // Otherwise unbalanced run on a final line: leave as-is per CommonMark.
  }
  return out.join('')
}
