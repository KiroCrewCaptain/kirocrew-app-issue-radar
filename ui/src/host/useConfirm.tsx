/**
 * The dashboard's `useConfirm` (`components/ConfirmDialog.tsx`) over the host's
 * `Modal` and `Btn` from `@kirocrew/app-sdk/ui`: `confirm(opts)` resolves `true`
 * only on the confirm press; Cancel, Escape, the close button and a backdrop click
 * resolve `false`. A second ask while one is open answers the first "no", and an
 * unmount answers "no", so no caller is left awaiting forever.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Btn, Modal } from '@kirocrew/app-sdk/ui'
import { i18nT } from './i18n'

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel: string
  danger?: boolean
  primary?: boolean
}

interface PendingConfirm {
  opts: ConfirmOptions
  resolve: (confirmed: boolean) => void
}

export function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  cancel: () => void
  confirmDialog: ReactNode
  confirmOpen: boolean
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)
  const lastOptsRef = useRef<ConfirmOptions | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>(resolve => {
      pendingRef.current?.resolve(false)
      const next = { opts, resolve }
      pendingRef.current = next
      lastOptsRef.current = opts
      setPending(next)
    })
  }, [])

  const settle = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed)
    pendingRef.current = null
    setPending(null)
  }, [])

  useEffect(() => () => {
    pendingRef.current?.resolve(false)
    pendingRef.current = null
  }, [])

  const opts = pending?.opts ?? lastOptsRef.current
  const confirmDialog = opts ? (
    <Modal
      open={!!pending}
      onClose={() => settle(false)}
      title={opts.title}
      maxWidth={440}
      footer={
        <>
          <Btn onClick={() => settle(false)}>{i18nT('components.confirmDialog.cancel')}</Btn>
          <Btn danger={!opts.primary && opts.danger !== false} primary={opts.primary} onClick={() => settle(true)}>
            {opts.confirmLabel}
          </Btn>
        </>
      }
    >
      {opts.body == null ? null : typeof opts.body === 'string'
        ? <p className="text-sm text-text m-0">{opts.body}</p>
        : <div className="text-sm text-text">{opts.body}</div>}
    </Modal>
  ) : null

  const cancel = useCallback(() => settle(false), [settle])

  return { confirm, cancel, confirmDialog, confirmOpen: !!pending }
}
