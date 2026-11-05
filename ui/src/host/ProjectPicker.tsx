/**
 * Stands where the dashboard's `ProjectPicker` stood in the repo settings: a small
 * panel anchored to the Browse button where the working-copy path is typed.
 *
 * The dashboard's picker lists recent and favourite projects and browses the
 * gateway's filesystem through dashboard routes outside this app's API grant, so a
 * bundle cannot offer those tabs. The backend validates the path when the setting
 * is saved, as it did for a picked one. PORTING.md lists the gap.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Btn, Input } from '@kirocrew/app-sdk/ui'
import { i18nT } from './i18n'
import { useDialogFocusTrap } from './useDialogFocusTrap'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef?: RefObject<HTMLElement | null>
  startPath?: string
  onSelect: (path: string) => void
}

export default function ProjectPicker({ open, onOpenChange, anchorRef, startPath = '', onSelect }: Props) {
  const [value, setValue] = useState(startPath)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) setValue(startPath) }, [open, startPath])
  useLayoutEffect(() => {
    const rect = anchorRef?.current?.getBoundingClientRect()
    setPos(rect ? { top: rect.bottom + 6, left: Math.max(8, rect.right - 360) } : { top: 120, left: 120 })
  }, [anchorRef, open])
  useDialogFocusTrap(panelRef, () => onOpenChange(false), { enabled: open })
  if (!open) return null
  const trimmed = value.trim()
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={i18nT('apps.issueRadar.host.projectPicker.title')}
      className="fixed z-[9999] w-[360px] rounded-lg border border-border bg-bg-elevated p-3 shadow-lg"
      style={pos ?? undefined}
    >
      <div className="mb-2 text-[12px] font-semibold text-muted">
        {i18nT('apps.issueRadar.host.projectPicker.title')}
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && trimmed) onSelect(trimmed)
        }}
        placeholder={i18nT('apps.issueRadar.host.projectPicker.placeholder')}
        aria-label={i18nT('apps.issueRadar.host.projectPicker.title')}
        className="w-full font-mono text-[12px]"
      />
      <div className="mt-2 text-[11px] text-muted">{i18nT('apps.issueRadar.host.projectPicker.hint')}</div>
      <div className="mt-3 flex justify-end gap-2">
        <Btn onClick={() => onOpenChange(false)}>{i18nT('components.confirmDialog.cancel')}</Btn>
        <Btn primary disabled={!trimmed} onClick={() => onSelect(trimmed)}>
          {i18nT('apps.issueRadar.host.projectPicker.use')}
        </Btn>
      </div>
    </div>,
    document.body,
  )
}
