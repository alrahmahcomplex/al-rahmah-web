// The lead page's tabs, in order. Each panel in LEAD_PANELS names its tab;
// the page renders only the current tab's panels.
export const LEAD_TABS = [
  { key: "overview", label: "Overview" },
  { key: "interview", label: "Interview" },
  { key: "school-fee", label: "School fee" },
  { key: "follow-ups", label: "Follow-ups" },
  { key: "discounts", label: "Discounts" },
] as const

export type LeadTab = (typeof LEAD_TABS)[number]["key"]

// The tab in the address (?tab=), Overview when it is missing or unknown.
export function leadTab(param: string | string[] | undefined): LeadTab {
  const value = Array.isArray(param) ? param[0] : param
  return LEAD_TABS.find((tab) => tab.key === value)?.key ?? "overview"
}

// The lead page on a tab, optionally scrolled to a panel.
export function leadTabHref(leadId: string, tab: LeadTab, anchor?: string): string {
  const query = tab === "overview" ? "" : `?tab=${tab}`
  return `/staff/leads/${leadId}${query}${anchor ? `#${anchor}` : ""}`
}
