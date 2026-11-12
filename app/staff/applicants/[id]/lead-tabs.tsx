import Link from "next/link"

import { cn } from "@/lib/utils"

import { LEAD_TABS, leadTabHref, type LeadTab } from "./tabs"

// The lead page's section tabs, links with aria-current on the open one. The
// prototype does not show tabs yet, so they keep today's look here until the
// owner approves theirs (#325); the approved look then replaces this file alone.
export function LeadTabs({ leadId, tab }: { leadId: string; tab: LeadTab }) {
  return (
    <nav aria-label="Application sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b">
        {LEAD_TABS.map(({ key, label }) => (
          <li key={key}>
            <Link
              href={leadTabHref(leadId, key)}
              scroll={false}
              aria-current={key === tab ? "page" : undefined}
              className={cn(
                "-mb-px flex h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                key === tab
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-muted-foreground hover:border-slate-300 hover:text-slate-900",
              )}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
