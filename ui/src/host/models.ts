/** The model-list helpers the crew editor used from the dashboard
 * (`providers/modelList.ts`, `components/ModelDropdownList.tsx`), restated: pure. */
import { fmtNumber } from './format'

/** Whether a credit multiplier is a usable price (finite and positive). */
export function isPricedMultiplier(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

const SUFFIX = 'x'

/** A credit multiplier as the picker shows it (`1.5×`), in the active locale. */
export function formatMultiplier(value: number): string {
  const rounded = Math.round(value * 100) / 100
  const digits = rounded === 0
    ? fmtNumber(value, { maximumSignificantDigits: 1 })
    : fmtNumber(rounded, { minimumFractionDigits: 1, maximumFractionDigits: 2 })
  return `${digits}${SUFFIX}`
}
