import { Tabs } from "@/components/kit"

import { LEAD_TABS, leadTabHref, type LeadTab } from "./tabs"

function withFrom(href: string, from: string | undefined): string {
  if (!from) return href
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}`
}

// The lead page's section tabs: the kit's Tabs (#358), links with
// aria-current on the open one. A tab only changes the section, so the page
// keeps its place. A record opened from the Interviews list keeps `from`
// on every tab, so its title still leads back to that list.
export function LeadTabs({ leadId, tab, from }: { leadId: string; tab: LeadTab; from?: string }) {
  const href = (key: LeadTab) => withFrom(leadTabHref(leadId, key), from)
  return (
    <Tabs
      label="Application sections"
      tabs={LEAD_TABS.map(({ key, label }) => ({ label, href: href(key) }))}
      current={href(tab)}
      scroll={false}
    />
  )
}
