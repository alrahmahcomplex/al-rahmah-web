import { cn } from "@/lib/utils"

import { BOOK_SHAPES, EMBLEM_ASPECT, EMBLEM_INDIGO, EMBLEM_ORANGE, EMBLEM_VIEW_BOX, GLOBE_SEGMENTS } from "./emblem-paths"

// The globe-and-book emblem from the official logo, without the lettering, in
// the logo's own printed colours. Decorative: whatever it sits beside names
// the school, so it is hidden from screen readers. `size` is its width in
// pixels; the height follows the emblem's shape.
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox={EMBLEM_VIEW_BOX}
      width={size}
      height={Math.round(size * EMBLEM_ASPECT)}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      {GLOBE_SEGMENTS.map((segment) => (
        <path key={segment.d} d={segment.d} fill={EMBLEM_ORANGE} />
      ))}
      {BOOK_SHAPES.map((shape) => (
        <path key={shape.d} d={shape.d} fill={EMBLEM_INDIGO} />
      ))}
    </svg>
  )
}
