/**
 * The app's own strings. A bundle cannot read the dashboard's catalogs (those
 * belong to the host and change with it), so every locale the dashboard ships is
 * bundled here and looked up against the host's active language.
 *
 * The catalogs (`ui/i18n/<locale>.json`) are the `apps.issueRadar.*` and
 * `apps.autoTriagePipeline.*` subtrees copied from Kiro Crew's dashboard catalogs
 * (English is `en.json` merged with `en.manual.json`, as the dashboard merges
 * them), plus the few shared dashboard strings the page used, under the SAME key
 * paths, so every call site reads as it did in the built-in.
 *
 * Lookup order: the exact locale (`pt`, `zh-CN`), then its base language, then
 * English, then the key itself. A numeric `count` selects the plural form the
 * locale's rules name (`_one`, `_few`, `_many`, `_other`), as the dashboard's
 * catalogs are keyed. `{{name}}` placeholders are filled from `vars`, each value
 * shown exactly as given; one with no value is left as written.
 *
 * `i18nT` reads the language at call time. The root component subscribes to the
 * host's language changes (`useLanguageGeneration`), and its re-render reaches
 * every child, so a language switch repaints the page without a reload.
 *
 * `useTranslation` and `Trans` stand where the built-in imported them from
 * `react-i18next`, with the subset of their contract the page uses.
 */

import { activeLocale } from '@kirocrew/app-sdk'
import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import bn from '../../i18n/bn.json'
import de from '../../i18n/de.json'
import en from '../../i18n/en.json'
import es from '../../i18n/es.json'
import fr from '../../i18n/fr.json'
import hi from '../../i18n/hi.json'
import it from '../../i18n/it.json'
import ja from '../../i18n/ja.json'
import ko from '../../i18n/ko.json'
import pt from '../../i18n/pt.json'
import ru from '../../i18n/ru.json'
import zhCN from '../../i18n/zh-CN.json'

interface Catalog {
  [key: string]: string | Catalog
}

const SHIPPED: Record<string, Catalog> = {
  bn,
  de,
  en,
  es,
  fr,
  hi,
  it,
  ja,
  ko,
  pt,
  ru,
  'zh-CN': zhCN,
}

/** Every catalog lookups consult: the shipped ones, plus any a test registers. */
export const CATALOGS: Readonly<Record<string, Catalog>> = SHIPPED

/** Add a catalog under `locale` (tests register the dashboard's dev-only
 * pseudolocale, `en-XA`, to prove a string goes through a catalog). */
export function registerCatalog(locale: string, catalog: Catalog): void {
  SHIPPED[locale] = catalog
}

const own = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

function lookup(catalog: Catalog | undefined, key: string): string | undefined {
  let node: string | Catalog | undefined = catalog
  for (const part of key.split('.')) {
    if (node === undefined || typeof node === 'string' || !own(node, part)) return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** The catalogs to try for `locale`, most specific first, always ending in English. */
export function localeChain(locale: string): string[] {
  const chain: string[] = []
  const add = (candidate: string) => {
    if (own(CATALOGS, candidate) && !chain.includes(candidate)) chain.push(candidate)
  }
  add(locale)
  add(locale.split('-')[0])
  add('en')
  return chain
}

export function currentLocale(): string {
  try {
    const locale = activeLocale()
    return typeof locale === 'string' && locale ? locale : 'en'
  } catch {
    return 'en'
  }
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g

function pluralForm(locale: string, count: number): string {
  try {
    return new Intl.PluralRules(locale).select(count)
  } catch {
    return count === 1 ? 'one' : 'other'
  }
}

export type Vars = Record<string, unknown>

/** The raw catalog string for `key` (plural form chosen), or `undefined`. */
function resolve(key: string, count: number | undefined): string | undefined {
  for (const locale of localeChain(currentLocale())) {
    const catalog = CATALOGS[locale]
    let text: string | undefined
    if (count !== undefined) {
      text = lookup(catalog, `${key}_${pluralForm(locale, count)}`) ?? lookup(catalog, `${key}_other`)
    }
    text = text ?? lookup(catalog, key)
    if (text !== undefined) return text
  }
  return undefined
}

function fill(text: string, vars: Vars | undefined): string {
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    vars && own(vars, name) && vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : whole,
  )
}

export function i18nT(key: string, vars?: Vars): string {
  const count = vars && typeof vars.count === 'number' ? vars.count : undefined
  const text = resolve(key, count)
  return text === undefined ? key : fill(text, vars)
}

/** Whether `key` has a string in any catalog the active locale falls back through. */
export function hasKey(key: string): boolean {
  return resolve(key, undefined) !== undefined || resolve(key, 0) !== undefined
}

/** `react-i18next`'s `useTranslation`, for the call sites that used it. */
export function useTranslation(): { t: (key: string, vars?: Vars) => string } {
  return { t: i18nT }
}

const TAG = /<(\w+)>([\s\S]*?)<\/\1>|<(\w+)\s*\/>/g

/** `react-i18next`'s `Trans` for the shape the page uses: a catalog string whose
 * `<name>…</name>` (or `<name/>`) spans are rendered with `components[name]`,
 * the element given there receiving the span's text as its children, and a
 * `<name/>` keeping the children the element was given. */
export function Trans({
  i18nKey,
  values,
  count,
  components = {},
}: {
  i18nKey: string
  values?: Vars
  count?: number
  components?: Record<string, ReactElement>
}): ReactNode {
  const vars: Vars = { ...(values ?? {}), ...(count === undefined ? {} : { count }) }
  const text = i18nT(i18nKey, vars)
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const match of text.matchAll(TAG)) {
    const at = match.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const name = match[1] ?? match[3]
    const inner = match[2] ?? ''
    const el = components[name]
    if (el && isValidElement(el)) {
      // A `<name/>` (or an empty span) keeps the element's own children, as
      // react-i18next does: `<code>{cli}</code>` under `<cli/>` shows the CLI name.
      const key = `t${n++}`
      out.push(inner ? cloneElement(el as ReactElement<{ children?: ReactNode }>, { key }, inner) : cloneElement(el, { key }))
    } else {
      out.push(inner)
    }
    last = at + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <Fragment>{out}</Fragment>
}
