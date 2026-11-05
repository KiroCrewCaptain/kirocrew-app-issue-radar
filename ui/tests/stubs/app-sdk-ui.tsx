/**
 * A stand-in for the host's `@kirocrew/app-sdk/ui`, at App Kit level 1.
 *
 * The built-in page's suites ran against the dashboard's own components, so the
 * simple ones are restated here from the dashboard's source (`components/ui.tsx`,
 * `Clickable.tsx`, `ErrorNotice.tsx`, `Modal.tsx`) with the same markup, roles,
 * labels, test ids and classes. What only the dashboard can do is dropped: the
 * agent hand-off of `ErrorNotice` (rendered as a marker button when asked for),
 * motion, haptics, the guide's markers. `MarkdownRenderer` renders its source as
 * text. `Select` is marked so a test can tell it from the native fallback.
 */

import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { twMerge } from 'tailwind-merge'
import type { SelectProps } from '@kirocrew/app-sdk/ui'
import { i18nT } from '../../src/host/i18n'
import { stubNavigate } from './app-sdk'

type Loose = { className?: string; children?: ReactNode; [prop: string]: unknown }

export function Card({ children, className = '', ...rest }: Omit<ComponentPropsWithoutRef<'div'>, 'dangerouslySetInnerHTML'>) {
  const owned = className.split(/\s+/)
  const ownsX = owned.some((c) => /^(?:p|px)-/.test(c))
  const ownsY = owned.some((c) => /^(?:p|py)-/.test(c))
  const inset = [ownsX ? '' : 'px-2 md:px-5', ownsY ? '' : 'py-5'].filter(Boolean).join(' ')
  return (
    <div className={twMerge(`card-glow border border-border bg-card rounded-lg ${inset} mb-4 animate-rise shadow-sm transition-all`, className)} {...rest}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className, ...rest }: Omit<ComponentPropsWithoutRef<'h3'>, 'dangerouslySetInnerHTML'>) {
  return <h3 className={twMerge('text-sm font-semibold tracking-tight text-text-strong mb-3.5 flex items-center gap-2', className)} {...rest}>{children}</h3>
}

export const Btn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; primary?: boolean }>(
  function Btn({ children, danger, primary, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={twMerge(`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[13px] cursor-pointer font-body transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
          primary ? 'bg-accent text-accent-fg border-accent' : danger ? 'border-border bg-transparent text-danger' : 'border-border bg-transparent text-text'
        }`, className)}
        {...rest}
      >
        {children}
      </button>
    )
  },
)

export const SendBtn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SendBtn({ type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} {...rest} />
  },
)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...props }, ref) {
    return <input ref={ref} className={twMerge('bg-bg-elevated border border-border rounded-md px-3 py-2 text-text text-sm', className)} {...props} />
  },
)

export function Badge({ variant, children, className, ...rest }: { variant?: 'ok' | 'err' | 'warn' | 'aim' | 'muted' } & Omit<ComponentPropsWithoutRef<'span'>, 'children'> & { children?: ReactNode }) {
  const cls =
    variant === 'ok' ? 'bg-ok-subtle text-ok-text'
    : variant === 'err' ? 'bg-danger-subtle text-danger-text'
    : variant === 'aim' ? 'bg-aim-subtle text-aim'
    : variant === 'muted' ? 'bg-[var(--bg-hover)] text-[var(--muted)]'
    : 'bg-warn-subtle text-warn-text'
  return (
    <span className={twMerge(`inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[13px] font-medium font-mono whitespace-nowrap ${cls}`, className)} {...rest}>
      {children}
    </span>
  )
}

export function InfoTip({ text }: { text: string }) {
  return <span title={text}>ⓘ</span>
}

export function StatCard({ label, value, accent, colorClass, delay, onClick, active, title, className, ...rest }: { label: string; value?: string | number | null; accent?: boolean; colorClass?: string; delay?: number; onClick?: () => void; active?: boolean; title?: string } & Omit<ComponentPropsWithoutRef<'div'>, 'title' | 'onClick'>) {
  const loading = value === undefined || value === null
  return (
    <div
      className={twMerge(`stat-accent relative overflow-hidden bg-card rounded-md px-4 py-3.5 border ${active ? 'border-accent ring-1 ring-accent/40' : 'border-border'} ${onClick ? 'cursor-pointer' : ''}`, className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      data-testid="stat-card"
      {...rest}
    >
      <div className="text-muted text-[13px] font-medium uppercase tracking-[.04em] flex items-center gap-1" data-testid="stat-card-label">{label}{title && <InfoTip text={title} />}</div>
      {loading
        ? <div className="skeleton h-7 w-16 mt-1.5 rounded" data-testid="stat-card-skeleton" />
        : <div className={`text-2xl font-bold mt-1.5 tracking-tight leading-none ${accent ? 'text-accent' : colorClass || ''}`} data-testid="stat-card-value">{value ?? '—'}</div>}
    </div>
  )
}

export function Skeleton({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div data-slot="skeleton" className={twMerge('bg-bg-hover animate-pulse rounded-md', className)} {...props} />
}

export function ContentSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3 w-72" />
      <div className="space-y-2 mt-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, subtitle, action, testId = 'empty-state' }: { icon: ReactNode; title: string; subtitle?: string; action?: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 animate-rise" data-testid={testId}>
      <div className="text-[40px] opacity-[.12] select-none">{icon}</div>
      <div className="text-muted text-sm font-medium" data-testid={`${testId}-title`}>{title}</div>
      {subtitle && <div className="text-muted text-[13px] text-center max-w-[320px]" data-testid={`${testId}-subtitle`}>{subtitle}</div>}
      {action && <div className="mt-2" data-testid={`${testId}-action`}>{action}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-4 md:px-6 pt-2 pb-3" data-testid="page-header">
      <div className="min-w-0">
        <div className="text-2xl font-bold tracking-tight text-text-strong" data-testid="page-title">{title}</div>
        {subtitle && <div className="text-muted text-sm mt-1" data-testid="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2.5 flex-wrap justify-end">{actions}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, disabled, label, describedBy, tone = 'accent' }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; describedBy?: string; tone?: 'accent' | 'muted' }) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={label}
      aria-describedby={describedBy}
      tabIndex={disabled ? -1 : 0}
      onClick={() => { if (!disabled) onChange(!checked) }}
      onKeyDown={e => { if (!disabled && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); onChange(!checked) } }}
      className={`w-9 h-5 rounded-full relative transition-colors shrink-0 cursor-pointer ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${checked ? (tone === 'muted' ? 'bg-border-strong' : 'bg-accent') : 'bg-border'}`}
    >
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </div>
  )
}

type ClickableProps = Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'onClick'> & {
  onClick: (e?: MouseEvent | KeyboardEvent) => void
  disabled?: boolean
}

export const Clickable = forwardRef<HTMLDivElement, ClickableProps>(
  function Clickable({ onClick, disabled, children, className, onKeyDown, tabIndex, ...props }, ref) {
    return (
      <div
        ref={ref}
        role="button"
        tabIndex={disabled ? -1 : tabIndex ?? 0}
        onClick={disabled ? undefined : onClick}
        onKeyDown={e => {
          onKeyDown?.(e)
          if (!disabled && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onClick(e)
          }
        }}
        aria-disabled={disabled || undefined}
        className={className}
        {...props}
      >
        {children}
      </div>
    )
  },
)

export function ErrorNotice({
  id,
  message,
  title,
  onDismiss,
  dismissLabel,
  dismissLabelVisible = false,
  variant = 'block',
  askAgent = false,
  messagePlacement = 'beside',
  footer,
  className = '',
  messageClassName = '',
  messageTooltip,
  testId,
  showIcon = true,
  handoffHint,
  announce = true,
}: {
  id?: string
  message?: string | null
  title?: string
  onDismiss?: () => void
  dismissLabel?: string
  dismissLabelVisible?: boolean
  variant?: 'block' | 'inline'
  askAgent?: boolean
  messagePlacement?: 'beside' | 'below'
  footer?: ReactNode
  className?: string
  messageClassName?: string
  messageTooltip?: string
  testId?: string
  showIcon?: boolean
  handoffHint?: string
  announce?: boolean
  [prop: string]: unknown
}) {
  // The dashboard's markup (components/ErrorNotice.tsx); the hand-off is a marker
  // button that records the host's navigation to the chat.
  if (!message) return null
  const messageBelow = messagePlacement === 'below' && Boolean(title)
  const dismissName = dismissLabel ?? i18nT('components.errorNotice.dismiss')
  const handoff = askAgent && (
    <button type="button" data-testid="ask-agent-stub" onClick={() => stubNavigate('/chat')}>Ask the agent</button>
  )
  const dismissButton = onDismiss && (
    <button type="button" className="shrink-0 bg-transparent border-none p-0 cursor-pointer" aria-label={dismissName} title={dismissName} onClick={onDismiss}>
      <span aria-hidden="true">×</span>
      {dismissLabelVisible && <span>{dismissName}</span>}
    </button>
  )
  if (variant === 'inline') {
    return (
      <span role={announce ? 'alert' : undefined} className={`inline-flex items-center gap-1.5 text-[12px] text-danger ${messageBelow ? 'flex-wrap' : ''} ${className}`} id={id} data-testid={testId}>
        {showIcon && <span aria-hidden="true" />}
        {title && <strong className="font-semibold">{title}</strong>}
        <span className={`min-w-0 ${messageBelow ? 'basis-full text-[11px] font-normal text-danger-text' : ''} ${messageClassName}`} title={messageTooltip}>{message}</span>
        {handoff}
        {!askAgent && handoffHint && <span data-testid="error-notice-handoff-hint">{handoffHint}</span>}
        {dismissButton}
      </span>
    )
  }
  return (
    <div role={announce ? 'alert' : undefined} className={`rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 flex items-start gap-2 text-[13px] text-danger-text ${className}`} id={id} data-testid={testId}>
      {showIcon && <span aria-hidden="true" />}
      <div className="min-w-0 flex-1 whitespace-pre-wrap">
        {title && <strong className="font-semibold">{title} </strong>}
        {messageBelow || messageClassName || messageTooltip
          ? <span className={`${messageBelow ? 'block text-[12px] font-normal text-danger-text' : ''} ${messageClassName}`} title={messageTooltip}>{message}</span>
          : message}
        {footer && <div className="mt-1 font-normal">{footer}</div>}
        {!askAgent && handoffHint && <div data-testid="error-notice-handoff-hint">{handoffHint}</div>}
      </div>
      {handoff}
      {dismissButton}
    </div>
  )
}

export function MarkdownRenderer({ content, className }: { content: string; className?: string }) {
  return <div className={className} data-testid="markdown-stub">{content}</div>
}

export function Modal({ open, onClose, title, footer, children }: { open: boolean; onClose: () => void; title?: ReactNode; footer?: ReactNode; children?: ReactNode; [prop: string]: unknown }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <h2>{title}</h2>
      <button type="button" aria-label={i18nT('components.dialog.close')} onClick={onClose}>×</button>
      {children}
      {footer}
    </div>
  )
}

/** Stands in for the host's themed dropdown; marked so a test can tell it from the fallback. */
export function Select({ options, optionLabels, value, onChange, clearLabel, disabled, 'aria-label': ariaLabel, title, className }: SelectProps) {
  return (
    <select data-host-select="" aria-label={ariaLabel} title={title} className={className} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {clearLabel !== undefined || !options.includes(value) ? <option value="">{clearLabel ?? ''}</option> : null}
      {options.map((o, i) => (
        <option key={o} value={o}>
          {optionLabels?.[i] ?? o}
        </option>
      ))}
    </select>
  )
}

export function SegmentedControl({ children }: Loose) {
  return <div role="radiogroup">{children}</div>
}

export const guideCaution = { 'data-guide-caution': '' } as const
