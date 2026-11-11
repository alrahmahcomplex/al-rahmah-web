import { cn } from "@/lib/utils"

import { ICONS, type IconName } from "./registry"
import "./icons.css"

/** 20px by default; 16px small and in the sidebar, 17px in the search field, 18px in a row disc, 19px in the sidebar toggle. */
export type IconSize = 16 | 17 | 18 | 19 | 20

export type IconProps = {
  name: IconName
  size?: IconSize
  /** Active without a hover or a current parent, as in a list row's disc. */
  featured?: boolean
  className?: string
}

/**
 * A set 2 line icon (DESIGN.md, Icons). At rest both layers take the text
 * colour. It turns active (indigo lines, the Peach Glow circle growing in)
 * when it is `featured`, or when a parent marked `data-icon-host` is hovered,
 * current (`aria-current`) or pressed (`aria-pressed="true"`). A host marked
 * `data-icon-host="indigo"` sits on indigo: white lines, orange circle. The
 * active look applies only inside the new staff shell (`data-shell="new"`) or
 * the kit page (`data-kit`). Decorative: the parent carries the name.
 */
export function Icon({ name, size = 20, featured, className }: IconProps) {
  const { outline, detail, circle } = ICONS[name]
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
      {circle && <circle className="gf-ic-glow" cx={circle.cx} cy={circle.cy} r={circle.r} />}
      <g className="gf-ic-line">{outline}</g>
      {detail && <g className="gf-ic-line">{detail}</g>}
    </svg>
  )
}
