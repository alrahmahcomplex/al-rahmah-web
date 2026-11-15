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
 * A set 1 line icon (DESIGN.md, Icons). At rest both lines take the text
 * colour. It turns active (the main line indigo, the detail orange) when it
 * is `featured`, or when a parent marked `data-icon-host` is hovered, current
 * (`aria-current`), pressed (`aria-pressed="true"`), open (`data-popup-open`)
 * or on (`data-on`). A host marked `data-icon-host="indigo"` sits on indigo:
 * a white main line and a light orange detail. The active look applies only
 * inside the new staff shell (`data-shell="new"`) or the kit page
 * (`data-kit`). Decorative: the parent carries the name.
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
