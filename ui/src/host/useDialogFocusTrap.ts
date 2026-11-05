/**
 * The dashboard's `useDialogFocusTrap` (`hooks/useDialogFocusTrap.ts`): focus moves
 * into the dialog on open and back on close, Tab wraps inside it, and Escape calls
 * `onEscape` unless an IME composition owns the key. Only the newest armed trap
 * wraps Tab, so a dialog opened over another keeps focus in the top one. Dropped:
 * the remote-crew hidden-pane stand-down, which a bundle cannot observe.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const armedTabTraps = new Set<number>()
let nextTrapOrder = 0
function newestArmedTrap(): number {
  let newest = -1
  for (const order of armedTabTraps) if (order > newest) newest = order
  return newest
}

export interface DialogFocusTrapOptions {
  enabled?: boolean
  handleEscape?: boolean
  restoreFocus?: boolean
}

export function useDialogFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  { enabled = true, handleEscape = true, restoreFocus = true }: DialogFocusTrapOptions = {},
): void {
  useEffect(() => {
    const restoreTo = restoreFocus ? (document.activeElement as HTMLElement | null) : null
    const first = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .find((el) => el.tabIndex >= 0)
    ;(first ?? containerRef.current)?.focus({ preventScroll: true })
    return () => restoreTo?.focus?.({ preventScroll: true })
  }, [containerRef, restoreFocus])

  const mountOrderRef = useRef(0)
  useLayoutEffect(() => { mountOrderRef.current = ++nextTrapOrder }, [])

  useLayoutEffect(() => {
    if (!enabled) return
    const order = mountOrderRef.current
    armedTabTraps.add(order)
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Escape' && handleEscape) {
        onEscape()
        return
      }
      const container = containerRef.current
      if (e.key !== 'Tab' || !container) return
      if (newestArmedTrap() !== order) return
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetParent !== null && el.tabIndex >= 0)
      if (!items.length) return
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      const wrapsForward = !e.shiftKey && active === lastEl
      const wrapsBackward = e.shiftKey && (active === firstEl || active === container)
      const refocuses = !wrapsForward && !wrapsBackward && !container.contains(active)
      if (!wrapsForward && !wrapsBackward && !refocuses) return
      e.preventDefault()
      ;(wrapsBackward ? lastEl : firstEl).focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      armedTabTraps.delete(order)
    }
  }, [containerRef, onEscape, enabled, handleEscape])
}
