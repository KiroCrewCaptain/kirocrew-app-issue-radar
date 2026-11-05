/** `react-router-dom`'s `MemoryRouter`, where the built-in's suites wrapped a page in
 * one. The bundle is not inside a router (it navigates through the host:
 * `src/host/router.tsx`), so the wrapper renders its children as they are. */
import type { ReactNode } from 'react'

export function MemoryRouter({ children }: { children?: ReactNode; initialEntries?: string[] }) {
  return <>{children}</>
}
