/**
 * Copying text, the part of the dashboard's `utils/clipboard.ts` the page uses.
 *
 * The async Clipboard API first, then the legacy `execCommand('copy')` through a
 * hidden textarea for a context that refuses it. The dashboard's relay to an
 * embedding desktop shell is host plumbing and is not reachable from a bundle.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** The dashboard's `copyCode`: the same copy, for a command line. */
export const copyCode = copyToClipboard
