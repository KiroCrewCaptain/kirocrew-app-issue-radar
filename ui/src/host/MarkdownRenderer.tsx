/**
 * The dashboard's `MarkdownRenderer`: the host's own, from `@kirocrew/app-sdk/ui`.
 *
 * The host does not export its `LinkOverrideCtx`, so the override a caller
 * provides is not consulted: links in rendered markdown are the host's ordinary
 * links. (The built-in's issue bodies turned `#123` links into reference cards
 * through it; PORTING.md lists the gap.)
 */
import { MarkdownRenderer } from '@kirocrew/app-sdk/ui'
import { createContext, type ReactNode } from 'react'

export type LinkOverride = (props: { href: string; children?: ReactNode }) => ReactNode | undefined

export const LinkOverrideCtx = createContext<LinkOverride | null>(null)

export default MarkdownRenderer
