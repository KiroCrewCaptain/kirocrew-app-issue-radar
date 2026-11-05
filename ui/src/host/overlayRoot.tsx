/** The dashboard's `OverlayPortal` (`components/overlayRoot.tsx`), portalling to
 * `<body>`: a bundle has no pane overlay root of its own to reach. */
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function OverlayPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}
