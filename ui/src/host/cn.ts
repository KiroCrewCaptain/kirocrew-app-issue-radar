/** The dashboard's `cn` (`lib/utils.ts`): `clsx`, then `tailwind-merge`, so a
 * later utility class wins over an earlier conflicting one exactly as it does in
 * the dashboard's own components. Both are bundled. */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
