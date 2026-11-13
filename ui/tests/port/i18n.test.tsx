/** The app's own catalogs (`src/host/i18n.tsx`, `ui/i18n/*.json`). */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CATALOGS, i18nT, localeChain, Trans } from '../../src/host/i18n'
import { stubLocale } from '../stubs/app-sdk'

const SRC = join(__dirname, '..', '..', 'src')
const LOCALES = ['bn', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt', 'ru', 'zh-CN']

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  )
}

function has(catalog: unknown, key: string): boolean {
  let node = catalog as Record<string, unknown> | string | undefined
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return false
    node = (node as Record<string, unknown>)[part] as Record<string, unknown> | string
  }
  return node !== undefined
}

describe('catalogs', () => {
  it('ships every locale the dashboard ships', () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...LOCALES].sort())
  })

  it('resolves every literal key the page names, in English', () => {
    const keyRe = /['"`]((?:apps\.(?:issueRadar|autoTriagePipeline)|components|app)\.[A-Za-z0-9_.]+)['"`]/g
    const missing: string[] = []
    for (const file of sources(SRC)) {
      for (const m of readFileSync(file, 'utf8').matchAll(keyRe)) {
        const key = m[1]
        if (key.endsWith('.')) continue // a prefix a template literal completes
        const plural = ['_one', '_other'].some(s => has(CATALOGS.en, key + s))
        if (!has(CATALOGS.en, key) && !plural) missing.push(`${file.slice(SRC.length + 1)}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('falls back from a regional tag to its language, then to English', () => {
    expect(localeChain('pt-BR')).toEqual(['pt', 'en'])
    expect(localeChain('zh-CN')).toEqual(['zh-CN', 'zh', 'en'].filter(l => l in CATALOGS))
    expect(localeChain('xx')).toEqual(['en'])
  })

  it('selects the plural form and fills placeholders as given', () => {
    stubLocale('en')
    expect(i18nT('apps.issueRadar.views.settings.repoSettings.first_issue_friendly_count', { count: 1, n: '1' }))
      .not.toBe(i18nT('apps.issueRadar.views.settings.repoSettings.first_issue_friendly_count', { count: 2, n: '2' }))
    expect(i18nT('apps.issueRadar.host.projectPicker.use')).toBe('Use this folder')
  })

  it('answers a missing key with the key itself', () => {
    expect(i18nT('apps.issueRadar.no.such.key')).toBe('apps.issueRadar.no.such.key')
  })

  it('reads the host language at call time', () => {
    stubLocale('de')
    expect(i18nT('apps.issueRadar.host.projectPicker.use')).toBe('Diesen Ordner verwenden')
  })

  it('keeps an element\'s own children under a self-closing tag, as react-i18next does', () => {
    stubLocale('en')
    const { container } = render(
      <Trans
        i18nKey="apps.issueRadar.views.settings.generalSettings.authenticated_through_cli"
        components={{ cli: <code>gh</code> }}
      />,
    )
    expect(container.querySelector('code')?.textContent).toBe('gh')
    expect(container.textContent).toContain('Authenticated through your local gh CLI')
  })

  it('gives a paired tag\'s element the span text from the catalog', () => {
    stubLocale('en')
    const { container } = render(
      <Trans
        i18nKey="apps.issueRadar.views.settings.repoSettings.triage_needed_of_open"
        values={{ n: '5', triage: '2' }}
        components={{ strong: <strong /> }}
      />,
    )
    expect(container.querySelector('strong')?.textContent).toBeTruthy()
  })
})
