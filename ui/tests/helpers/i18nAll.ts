/**
 * What the built-in's suites imported from the dashboard's `i18n/all` (every
 * catalog loaded into i18next) and `i18n` (`initI18n`), over this app's own
 * catalogs: `changeLanguage` sets the stub host's active language, which
 * `host/i18n.tsx` reads at call time, and `t` is the app's lookup.
 */
import { i18nT, registerCatalog } from '../../src/host/i18n'
import enXA from '../fixtures/en-XA.json'
import { activeLocale, stubLocale } from '../stubs/app-sdk'

export const i18next = {
  async changeLanguage(lng?: string): Promise<(key: string, vars?: Record<string, unknown>) => string> {
    // The dashboard's dev-only pseudolocale, registered on first use: the bundle
    // never ships it.
    if (lng === 'en-XA') registerCatalog('en-XA', enXA)
    stubLocale(lng || 'en')
    return i18nT
  },
  get language(): string {
    return activeLocale()
  },
  get resolvedLanguage(): string {
    return activeLocale()
  },
  t: (key: string, vars?: Record<string, unknown>): string => i18nT(key, vars),
}

export async function initI18n(): Promise<void> {}
