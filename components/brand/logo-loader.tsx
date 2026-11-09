import { cn } from "@/lib/utils"

import { BOOK_SHAPES, EMBLEM_ASPECT, EMBLEM_INDIGO, EMBLEM_ORANGE, EMBLEM_VIEW_BOX, GLOBE_SEGMENTS } from "./emblem-paths"
import styles from "./logo-loader.module.css"

// The emblem while something loads: every loading.tsx and the import's
// "Checking…" step. It is the only loading motion in the staff portal; the
// skeletons around it stay still. Hidden from screen readers, so whatever
// holds it says what is loading (PageSkeleton does). `size` is its width in
// pixels.
export function LogoLoader({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox={EMBLEM_VIEW_BOX}
      width={size}
      height={Math.round(size * EMBLEM_ASPECT)}
      aria-hidden="true"
      focusable="false"
      data-slot="logo-loader"
      className={cn("shrink-0", styles.loader, className)}
    >
      <g className={styles.breath}>
        {BOOK_SHAPES.map((shape) => (
          <path
            key={shape.d}
            d={shape.d}
            fill={EMBLEM_INDIGO}
            className={shape.side === "cover" ? undefined : styles.page}
            data-side={shape.side}
            data-layer={shape.layer}
          />
        ))}
        {GLOBE_SEGMENTS.map((segment) => (
          <path key={segment.d} d={segment.d} fill={EMBLEM_ORANGE} className={styles.segment} data-beat={segment.beat} />
        ))}
      </g>
    </svg>
  )
}
