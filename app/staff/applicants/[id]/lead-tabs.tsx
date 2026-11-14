import { Tabs } from "@/components/kit"

import { LEAD_TABS, leadTabHref, type LeadTab } from "./tabs"

// The lead page's section tabs: the kit's Tabs (#358), links with
// aria-current on the open one. A tab only changes the section, so the page
// keeps its place.
export function LeadTabs({ leadId, tab }: { leadId: string; tab: LeadTab }) {
  return (
    <Tabs
      label="Application sections"
      tabs={LEAD_TABS.map(({ key, label }) => ({ label, href: leadTabHref(leadId, key) }))}
      current={leadTabHref(leadId, tab)}
      scroll={false}
    />
  )
}
