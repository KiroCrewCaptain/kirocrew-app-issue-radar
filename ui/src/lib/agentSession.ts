// Shared "open an agent chat session for one tracked item" orchestration, used
// by BOTH the issue Investigate action (lib/investigate.ts) and the pull-request
// Review action (lib/review.ts). Only the seed PROMPT and the slot TITLE differ
// between the two.
//
// The session is opened through the host's chat launcher (`useChatLauncher` from
// `@kirocrew/app-sdk`), the one chat surface an installed app has. The built-in
// dispatched the dashboard's own Redux thunks and chat API from inside the
// dashboard bundle: it filed the slot into a per-repo "Issue Radar - <repo>"
// folder, titled it, opened it in the repo's working copy, seeded and ran the
// first turn, probed a recorded slot for liveness before resuming, and linked the
// new slot's key to the item's record so a repeat click resumed it. None of that
// is reachable from a bundle (PORTING.md lists the gap). What this copy does:
//
// * a record that names a session (`slot_key`, written by the built-in) is
//   RESUMED by opening that session, once the app's own liveness read
//   (`GET /pipeline/live-slots`) says it still exists;
// * a record whose work CONCLUDED is not re-run on a click: the click is declined
//   (`concludedFor`) and a second, explicit click (`force`) starts over -- the
//   built-in's guard, applied to every record because a session this copy opens
//   is not linked to its record (the launcher names no slot);
// * otherwise a NEW session is opened as a draft with the seed prompt staged in
//   the composer (`memoryMode: 'persistent'`, `sessionFolder: false`, the memory
//   contract the built-in chose for app workstreams), and the record is marked
//   `investigating`. The person presses Send.
//
// The per-item record is the SAME store on both sides
// (via /api/apps/issue-radar/investigation), NAMESPACED by item kind. On GitHub
// the namespace is shared and the filename keeps its
// ``investigation-{number}.json`` form: issues and pull requests are drawn from
// ONE number sequence per repo, so they cannot collide. GitLab numbers them
// independently -- issue ``#5`` and merge request ``!5`` are unrelated items -- so a
// change request passes ``kind: 'pull'`` and gets its own record.
import { useCallback, useState } from 'react'
import { useChatLauncher } from '@kirocrew/app-sdk'
import { useNavigate } from '../host/router'
import { issueRadarApi, type InvestigationRecord, type ItemKind, RepoRef } from '../api'
import { autoTriagePipelineFoldApi } from '../pipeline/api'
import { repoScopeKey } from './links'

/** Keep a title short enough to read in a session list. */
const TITLE_MAX = 48

export function truncate(s: string, max: number = TITLE_MAX): string {
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s
}

/** Identity of one investigable item, for state that must not follow the user to
 * a different one.
 *
 * The detail pane is NOT keyed by the selected item (`Workspace.tsx` renders
 * `<IssueDetail issue={activeIssue} />` with no `key`), so selecting another issue
 * re-renders the SAME component instance with a new prop. A bare boolean "this
 * click was declined" therefore survives the switch, and the next item would
 * render its re-run affordance and force past the guard on a first click -- on an
 * item nobody declined. Storing WHICH item was declined and comparing at render
 * closes that without an effect, so there is no window where the wrong label is
 * painted. */
export function itemKey(repoRef: RepoRef, number: number, kind: ItemKind = 'issue'): string {
  return `${repoScopeKey(repoRef)}#${kind}:${number}`
}

export interface OpenSessionArgs {
  repoRef: RepoRef
  /** Issue OR change-request number. */
  number: number
  /** Which sequence `number` belongs to. Defaults to `issue`; a change request
   * must pass `pull`, because on GitLab the two are numbered independently and a
   * shared record would resume the wrong session. */
  kind?: ItemKind
  /** Slot title, already formatted (e.g. "#123 · Fix the thing"). */
  title: string
  /** The fully-built seed prompt for the first turn. */
  prompt: string
  /** The item's existing record, when it has one (drives resume). */
  existing: InvestigationRecord | null
  /** Local working-directory path for the chat session, from the repo's
   * `workspace_path` setting. Empty/undefined leaves the session on the default
   * cwd. Applied only on a FRESH session; a resumed slot keeps the cwd it was
   * born with. */
  workspacePath?: string
  /** Open a replacement session even though the item's work already CONCLUDED.
   *
   * Off by default, and that default is the point: a concluded record whose
   * session has been closed must not silently start the work over (see the
   * concluded branch below). The UI sets this only from a second, explicit
   * click, so re-doing finished work is always something the user asked for. */
  force?: boolean
}

export interface UseAgentSession {
  /** Open (or resume) the session, then navigate to /chat. Returns the linked
  /** Open (or resume) the session, then navigate to /chat. Returns the linked
   * record, or null on failure.
   *
   * A DECLINED click also returns a record -- the freshly-read one -- because the
   * callers' only use of the return value is to write it into their query cache,
   * and a decline is precisely the moment their cached copy has been proven
   * stale. So null-ness does not mean "declined": `concludedFor` is the decline
   * signal, and it is what the button reads to offer Start over. */
  openSession: (args: OpenSessionArgs) => Promise<InvestigationRecord | null>
  busy: boolean
  error: Error | null
  /** `itemKey` of the item whose click was DECLINED because its work had already
   * concluded and its session is gone — or null when the last click was not
   * declined. Not an error: nothing failed and there is nothing to retry.
   *
   * An IDENTITY rather than a boolean, because the detail pane is reused across
   * items (see `itemKey`), so a flag would follow the user to the next one and
   * force past the guard there on a first click. Callers compare it against their
   * own item.
   *
   * Cleared by the next `openSession` rather than by a separate resetter: every
   * call clears it on entry, so a click declined again simply re-sets it. */
  concludedFor: string | null
  /** Go to the chat page with its Older Sessions pane already open — where a
   * closed session's transcript is.
   *
   * The counterpart to declining the click. A concluded item's session has been
   * closed, and `api_chat_slot_delete` archives a session before popping the
   * slot, so the transcript is still readable; rehydrating it is what is refused
   * (`adopt_closed` gates that and this app never passes it). So the only correct
   * affordance is to point at history — and pointing has to be something the user
   * can DO, not a sentence naming a pane they then have to find.
   *
   * Lives here rather than in the button because navigation is already this
   * module's job (`openSession` ends in `navigate('/chat')`), which keeps
   * `AgentSessionButton` free of router context — it is shared presentation, and
   * two of its tests render it without a router. */
  openOlderSessions: () => void
}

export function useAgentSession(): UseAgentSession {
  const { openChat } = useChatLauncher()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [concludedFor, setConcludedFor] = useState<string | null>(null)

  const openSession = useCallback(
    async ({ repoRef, number, kind = 'issue', prompt, existing, force = false }: OpenSessionArgs): Promise<InvestigationRecord | null> => {
      setBusy(true)
      setError(null)
      setConcludedFor(null)
      try {
        // ── Resume: reattach to a still-live session, else fall through.
        //
        // PROBE before opening: a slot that is gone must not be "resumed" onto the
        // chat page's not-found notice, and only a slot known to be gone justifies
        // the decline or a replacement below. A failed probe throws (retryable),
        // never reads as "gone".
        const resumeIfLive = async (slotKey: string) => {
          const live = await autoTriagePipelineFoldApi.liveSlots([slotKey])
          if (!live.some(s => s.key === slotKey)) return null
          // A failed timestamp touch is not a reason to open a second session.
          const res = await issueRadarApi.saveInvestigation(repoRef, number, {}, kind)
          openChat({ slotKey })
          return res.investigation
        }

        if (existing) {
          if (existing.slot_key) {
            const reattached = await resumeIfLive(existing.slot_key)
            if (reattached) return reattached
          }
          // Re-read before deciding: the cached record is read cache-first with a
          // 30s staleTime, and the window that matters is the one where the agent
          // has just recorded its verdict. A failed re-read propagates (retryable)
          // rather than guessing from the stale copy.
          const fresh = await issueRadarApi.getInvestigation(repoRef, number, kind)
          const current = fresh.investigation ?? existing
          // The record may name a DIFFERENT session than the cached one (another
          // tab started over): try that one too before opening a third.
          if (current.slot_key && current.slot_key !== existing.slot_key) {
            const reattachedFresh = await resumeIfLive(current.slot_key)
            if (reattachedFresh) return reattachedFresh
          }
          // Work that CONCLUDED is not re-run on a click: closing the session is
          // how a person marks it done. `present AND not investigating` fails
          // closed on a status this build does not know; an ABSENT status is the
          // store's own default (`investigating`), not evidence of finished work.
          // A record this copy wrote has no `slot_key` (the launcher names no
          // slot), so the check applies to every record, not only a linked one.
          const concludedBefore = !!current.status && current.status !== 'investigating'
          if (!force && concludedBefore) {
            setConcludedFor(itemKey(repoRef, number, kind))
            return current
          }
        }
        // ── A fresh session. The record is marked first, so a failed write leaves
        // no chat behind that the record does not know about; then the draft
        // opens. NOT `findings: null`: the prior verdict survives until the new
        // run records its own (the built-in's rule).
        const res = await issueRadarApi.saveInvestigation(repoRef, number, { status: 'investigating' }, kind)
        openChat({ message: prompt, memoryMode: 'persistent', sessionFolder: false })
        return res.investigation
      } catch (e) {
        setError(e as Error)
        return null
      } finally {
        setBusy(false)
      }
    },
    [openChat],
  )

  // `?history=1`: the chat sidebar reads it when it mounts and opens its Older
  // Sessions pane, where a closed session's transcript is.
  const openOlderSessions = useCallback(() => { navigate('/chat?history=1') }, [navigate])

  return { openSession, busy, error, concludedFor, openOlderSessions }
}
