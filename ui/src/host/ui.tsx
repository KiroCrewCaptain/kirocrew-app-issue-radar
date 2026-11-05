/**
 * The dashboard's `components/ui` names the page uses. All but one are the host's
 * own components from `@kirocrew/app-sdk/ui`; `IconButton` is not exported there
 * and is restated with the same classes (the dashboard's hover label bubble is
 * host plumbing, so the button carries its `aria-label` as a native `title`).
 */
import * as React from 'react'
import { twMerge } from 'tailwind-merge'

export { Badge, Btn, Card, CardTitle, EmptyState, Input, PageHeader, StatCard, Toggle } from '@kirocrew/app-sdk/ui'

const ICON_BUTTON_VARIANTS: Record<'default' | 'accent' | 'danger' | 'active', string> = {
  default: 'text-muted hover:text-text hover:bg-bg-hover',
  accent: 'text-muted hover:text-accent hover:bg-bg-hover',
  danger: 'text-muted hover:text-danger-text hover:bg-danger-subtle',
  active: 'text-accent hover:bg-bg-hover',
}

export const IconButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { variant?: keyof typeof ICON_BUTTON_VARIANTS; 'aria-label': string }
>(({ variant = 'default', className, children, ...rest }, ref) => (
  <button
    ref={ref}
    type="button"
    title={rest.title === undefined ? rest['aria-label'] : undefined}
    className={twMerge(
      'p-[4px] rounded transition-all active:scale-[0.97] active:duration-75 cursor-pointer bg-transparent border-none disabled:opacity-30 disabled:cursor-not-allowed',
      ICON_BUTTON_VARIANTS[variant],
      className,
    )}
    {...rest}
  >
    {children}
  </button>
))
IconButton.displayName = 'IconButton'
