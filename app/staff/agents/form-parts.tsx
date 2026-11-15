import Link from "next/link"
import type { ReactNode } from "react"

// Marketing Agents' "Agent status" links (#330), the one part the kit does not
// have yet. Each filter is a link (a search param), so the kit's FilterPills,
// which are toggle buttons, cannot draw them. This row wears the kit's filter
// pill classes, and the chosen link takes the pressed pill's look through
// aria-current (agents.css). Follow-up: a link mode for FilterPills (#419),
// and this file goes.

/**
 * Links that switch the view, in a named <nav>, wrapping like the kit's
 * filter pills: the one whose `href` is `current` has aria-current="page". A
 * label may carry a count. `children` follow the links (a Clear search link).
 */
export function FilterLinks({
  label,
  links,
  current,
  children,
}: {
  label: string
  links: { label: ReactNode; href: string }[]
  current: string | null
  children?: ReactNode
}) {
  return (
    <nav aria-label={label} className="kit-tools ag-filters">
      {links.map((link) => (
        <Link key={link.href} href={link.href} aria-current={link.href === current ? "page" : undefined} className="kit-fpill">
          {link.label}
        </Link>
      ))}
      {children}
    </nav>
  )
}
