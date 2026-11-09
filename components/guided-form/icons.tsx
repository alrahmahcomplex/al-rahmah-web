import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

// The prototype's line icons: 24px grid, stroke 2, round caps and joins.
const PATHS = {
  check: <path d="M20 6 9 17l-5-5" />,
  back: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5v.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2" />
      <path d="M9 2h6" />
    </>
  ),
  reset: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  menu: <path d="M9.6 6.4h10M4.4 12h15.2M4.4 17.6h10.4" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

/** A decorative line icon from the prototype's set. 20px, or 16px with `small`. */
export function Icon({ name, small, className }: { name: IconName; small?: boolean; className?: string }) {
  return (
    <svg className={cn("gf-icon", small && "gf-s", className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}
