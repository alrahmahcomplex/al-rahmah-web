import Link from "next/link"

// The one place the Seats screen draws its year switcher. The kit's Tabs are
// #358 (Redesign F7, waiting on the owner's approval of prototype v16): links
// in the filter-pill look, the current one marked aria-current="page". Until
// it lands this is today's markup unchanged, and the PR that converts this
// screen stays a draft. When #358 merges, swap the body for the kit Tabs and
// keep these props.
//
// label: the nav's name. tabs: each year's text and href. current: the href
// of the year on screen, or null when none is.
export type YearTab = { label: string; href: string }

export function YearTabs({ label, tabs, current }: { label: string; tabs: YearTab[]; current: string | null }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className="rounded-md px-2.5 py-1 ring-1 ring-foreground/10 hover:bg-muted/50 aria-[current=page]:bg-muted aria-[current=page]:font-semibold"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
