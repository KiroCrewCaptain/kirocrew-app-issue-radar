/**
 * Navigation through the host (`useNavigate` from `@kirocrew/app-sdk`), where the
 * built-in page used `react-router-dom` directly: an installed app's bundle is not
 * inside the dashboard's router, so it asks the host to navigate.
 */
import { useNavigate as useHostNavigate } from '@kirocrew/app-sdk'
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'

export function useNavigate(): (path: string) => void {
  return useHostNavigate()
}

/** `react-router-dom`'s `Link` for an in-dashboard path: a real anchor (so a
 * modified click opens a new tab) whose plain click navigates through the host. */
export function Link({
  to,
  children,
  onClick,
  ...rest
}: { to: string; children?: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const navigate = useHostNavigate()
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
