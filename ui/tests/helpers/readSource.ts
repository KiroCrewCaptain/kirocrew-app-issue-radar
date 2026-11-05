/** The dashboard's test `readSource`: a file's text with line endings normalized to LF. */
import { readFileSync } from 'node:fs'

export function readSource(path: string): string {
  return readFileSync(path, 'utf-8').replace(/\r\n/g, '\n')
}
