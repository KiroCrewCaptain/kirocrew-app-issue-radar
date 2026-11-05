/**
 * The dashboard's `SimpleSelect`, served by the host's `Select` (App Kit level 1,
 * which IS that component behind a reduced prop set) or a native `<select>`.
 *
 * Dropped with the props the host's `Select` does not carry: `optionBadges` (the
 * crew editor's credit-multiplier pills beside each model) and `optionIcons`.
 * PORTING.md lists that as a gap.
 */
import type { CSSProperties, ReactNode } from 'react'
import { Select } from './hostSdk'

export interface SimpleSelectProps {
  options: string[]
  optionLabels?: string[]
  optionIcons?: ReactNode[]
  optionBadges?: ({ label: string; source: string; hint?: string } | undefined)[]
  value: string
  onChange: (value: string) => void
  clearLabel?: string
  disabled?: boolean
  'aria-label'?: string
  title?: string
  className?: string
  /** Applied to a wrapper, since the host's `Select` takes no style. */
  style?: CSSProperties
}

export default function SimpleSelect({
  options,
  optionLabels,
  value,
  onChange,
  clearLabel,
  disabled,
  'aria-label': ariaLabel,
  title,
  className,
  style,
}: SimpleSelectProps) {
  const select = (
    <Select
      options={options}
      optionLabels={optionLabels}
      value={value}
      onChange={onChange}
      clearLabel={clearLabel}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={className}
    />
  )
  return style ? <span className="inline-flex" style={style}>{select}</span> : select
}
