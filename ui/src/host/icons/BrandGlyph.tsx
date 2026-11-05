/** The dashboard's `BrandGlyph` (`components/BrandIcon.tsx`): a mark drawn as a
 * theme-aware CSS mask over `currentColor`. */
import type { CSSProperties } from 'react'

export function BrandGlyph({ url, size, height, className = 'inline-block shrink-0', testId, style }: {
  url: string
  size: number
  height?: number
  className?: string
  testId?: string
  style?: CSSProperties
}) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className={className}
      style={{
        width: size,
        height: height ?? size,
        backgroundColor: 'currentColor',
        // Quoted: an inlined `data:` URI's commas and `#` break an unquoted url().
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        ...style,
      }}
    />
  )
}
