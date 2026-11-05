/**
 * The dashboard's `findReport` (`utils/errorReport.ts`) looks a failure up in the
 * dashboard's own error journal, so its "ask an agent" hand-off can carry the
 * journaled report. A bundle cannot read that journal; this answers "no report",
 * and the notice falls back to its message, as it does for a failure the journal
 * never saw.
 */
export function findReport(_message: string): undefined {
  return undefined
}
