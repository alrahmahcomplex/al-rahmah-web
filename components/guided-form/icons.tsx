import type { ReactElement } from "react"

import { ICONS, type IconName } from "@/components/icons/registry"
import { cn } from "@/lib/utils"

export type { IconName }

// The registry splits menu's three lines into two layers for the staff
// highlight. Drawn as two paths, the bottom line's edge pixels come out a
// shade different, so the form keeps its single path, same lines.
const FORM_ONLY_MARKUP: Partial<Record<IconName, ReactElement>> = {
  menu: <path d="M9.6 6.4h10M4.4 12h15.2M4.4 17.6h10.4" />,
}

/**
 * A decorative line icon from the shared registry (components/icons), drawn
 * the way the Admission form always drew it: both layers in the text colour,
 * no highlight circle. 20px, or 16px with `small`.
 */
export function Icon({ name, small, className }: { name: IconName; small?: boolean; className?: string }) {
  const { outline, detail } = ICONS[name]
  return (
    <svg className={cn("gf-icon", small && "gf-s", className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {FORM_ONLY_MARKUP[name] ?? (
        <>
          {outline}
          {detail}
        </>
      )}
    </svg>
  )
}
