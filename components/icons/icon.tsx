import { cn } from "@/lib/utils"

import { ICONS, type IconName } from "./registry"
import "./icons.css"

/** 20px by default; 16px small and in the sidebar, 17px in the search field, 18px in a row disc, 19px in the sidebar toggle, 24px on its own. */
export type IconSize = 16 | 17 | 18 | 19 | 20 | 24

export type IconProps = {
  name: IconName
  size?: IconSize
  /** Active without a hover or a current parent, as in a list row's disc. */
  featured?: boolean
  className?: string
}

/**
 * A set 1 line icon (DESIGN.md, Icons). At rest both lines are Rahmah Indigo,
 * never grey; inside a button, a tick, a step dot or a part marked
 * `data-icon-tone="inherit"` it takes the text colour instead (icons.css). It
 * turns active, its detail orange, when it is `featured`, or when a parent
 * marked `data-icon-host` is hovered, current (`aria-current`), pressed
 * (`aria-pressed="true"`), open (`aria-expanded="true"`, `data-popup-open`)
 * or on (`data-on`). A host marked `data-icon-host="indigo"` sits on indigo:
 * white, with a light orange detail in use. Decorative: the parent carries
 * the name.
 */
export function Icon({ name, size = 20, featured, className }: IconProps) {
  const { outline, detail } = ICONS[name]
  return (
    <svg
      className={cn("gf-ic", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-featured={featured ? "" : undefined}
    >
      <g className="gf-ic-line">{outline}</g>
      {detail && <g className="gf-ic-detail">{detail}</g>}
    </svg>
  )
}
