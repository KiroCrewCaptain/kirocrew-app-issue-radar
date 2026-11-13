/**
 * Sentences around a name, chip, inline code or markup are one message each
 * (Kiro Crew #33275, #33327, #34380): a timeline line, the linked-refs heading,
 * the repo settings toggles and warnings, and the CLI sign-in lines. No language
 * could order them its own way while they were glued from fragments. Restated
 * from the dashboard's `IssueRadarMarkupSentences`, `StyledNameWholeSentences`
 * and `InlineCodeWholeSentences` suites, over this app's own catalogs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CATALOGS, Trans } from '../../src/host/i18n'
import { stubLocale } from '../stubs/app-sdk'

const SRC = path.resolve(__dirname, '..', '..', 'src')
const LANGS = ['de', 'es', 'fr', 'it', 'pt', 'ru', 'ja', 'ko', 'zh-CN', 'hi', 'bn']
const ISSUE = 'apps.issueRadar.components.issueDetail'
const PR = 'apps.issueRadar.components.prDetail'
const REPO = 'apps.issueRadar.views.settings.repoSettings'
const GENERAL = 'apps.issueRadar.views.settings.generalSettings'

// key -> [English text, parts every language must carry, each as often as English]
const SENTENCES: Record<string, [string | null, string[]]> = {
  [`${ISSUE}.added_the_label_chip`]: ['<who/> added the <label/> label', ['<who/>', '<label/>']],
  [`${ISSUE}.removed_the_label_chip`]: ['<who/> removed the <label/> label', ['<who/>', '<label/>']],
  [`${ISSUE}.added_this_to_the_milestone_name`]: ['<who/> added this to the <milestone/> milestone', ['<who/>', '<milestone/>']],
  [`${ISSUE}.removed_this_from_the_milestone_name`]: ['<who/> removed this from the <milestone/> milestone', ['<who/>', '<milestone/>']],
  [`${ISSUE}.changed_the_title_from_to`]: ['<who/> changed the title <from/> → <to/>', ['<who/>', '<from/>', '<to/>']],
  [`${ISSUE}.linked_change_requests_and_issues`]: ['Linked {{changeRequests}} & issues', ['{{changeRequests}}']],
  [`${PR}.added_the_label_chip`]: ['<who/> added the <label/> label', ['<who/>', '<label/>']],
  [`${PR}.removed_the_label_chip`]: ['<who/> removed the <label/> label', ['<who/>', '<label/>']],
  [`${PR}.added_this_to_the_milestone_name`]: ['<who/> added this to the <milestone/> milestone', ['<who/>', '<milestone/>']],
  [`${PR}.changed_the_title_from_to`]: ['<who/> changed the title <from/> → <to/>', ['<who/>', '<from/>', '<to/>']],
  [`${REPO}.notify_me_when_a_new_issue_is_opened_in`]: ['Notify me when a <newIssue/> is opened in {{repo}}', ['<newIssue/>', '{{repo}}']],
  [`${REPO}.investigate_runs_in_path`]: ['New Investigate sessions will run in <path/>.', ['<path/>']],
  // `null`: the English text is pinned by the parts alone.
  [`${GENERAL}.authenticated_through_cli`]: [null, ['<cli/>']],
  ['apps.issueRadar.connectPanel.reads_through_cli_session']: [
    'Issue Radar reads {{provider}} through your own <cli/> session. Install and sign in to <cli/>, then <retry/>.',
    ['{{provider}}', '<cli/>', '<retry/>'],
  ],
}

function lookup(locale: string, key: string): string | undefined {
  let node: unknown = CATALOGS[locale]
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

const count = (text: string, part: string) => text.split(part).length - 1

describe('Issue Radar markup sentences', () => {
  it('keeps the English text', () => {
    for (const [key, [en, parts]] of Object.entries(SENTENCES)) {
      const value = lookup('en', key)
      if (en !== null) expect(value, key).toBe(en)
      for (const part of parts) expect(value, `${key} ${part}`).toContain(part)
    }
  })

  it('carries every inserted part as often as English in every shipped language', () => {
    for (const lng of LANGS) {
      for (const [key, [, parts]] of Object.entries(SENTENCES)) {
        const en = lookup('en', key)!
        const value = lookup(lng, key)
        expect(value, `${lng} ${key}`).toBeTypeOf('string')
        for (const part of parts) expect(count(value!, part), `${lng} ${key} ${part}`).toBe(count(en, part))
      }
    }
  })

  it('no longer glues these sentences from parts', () => {
    const gone: Record<string, string[]> = {
      'components/IssueDetail.tsx': [
        'issueDetail.added_the',
        'issueDetail.removed_the',
        'issueDetail.label',
        'issueDetail.added_this_to_the',
        'issueDetail.removed_this_from_the',
        'issueDetail.milestone',
        'issueDetail.linked',
        'issueDetail.issues',
        'issueDetail.changed_the_title',
      ],
      'components/PrDetail.tsx': [
        'prDetail.added_the',
        'prDetail.removed_the',
        'prDetail.label',
        'prDetail.added_this_to_the',
        'prDetail.milestone',
        'prDetail.changed_the_title',
      ],
      'views/settings/RepoSettings.tsx': [
        'repoSettings.notify_me_when_a',
        'repoSettings.is_opened_in',
        'repoSettings.removes',
        'repoSettings.data_and',
        'repoSettings.auth_are_untouched_you_can_reconnect_anytime',
      ],
    }
    for (const [file, keys] of Object.entries(gone)) {
      const lines = fs.readFileSync(path.join(SRC, file), 'utf8').split('\n')
      // The closing quote keeps a longer key that shares the prefix from matching.
      const left = lines.filter((line) => keys.some((key) => line.includes(`${key}')`))).map((line) => line.trim())
      expect(left, file).toEqual([])
    }
  })

  it('renders the inserted element with its own content in place of a self-closing tag', () => {
    stubLocale('ja')
    const { container } = render(
      <Trans
        i18nKey={`${ISSUE}.added_this_to_the_milestone_name`}
        components={{ who: <b>octocat</b>, milestone: <span>v1.0</span> }}
      />,
    )
    expect(container.querySelector('b')?.textContent).toBe('octocat')
    expect(container.querySelector('span')?.textContent).toBe('v1.0')
    stubLocale('en')
  })
})
