import type { Metadata } from "next"

import { pageTitle } from "@/components/kit"
import { tanzaniaToday } from "@/lib/school-calendar"

import { requireStaff } from "../session"

import { KitPage } from "./kit-page"

export const metadata: Metadata = {
  title: pageTitle("Design system"),
  robots: { index: false, follow: false },
}

// The kit page (#319): the approved prototype's "Design system" page rebuilt
// with components/kit, then the kit's other pieces, all with fixture text.
// Any signed-in staff member may open it; it is not in the sidebar.
export default async function DesignSystemPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; filter?: string | string[] }> }) {
  await requireStaff()
  const { tab, filter } = await searchParams
  // The form parts card's Tabs are links; the open one is ?tab=. The link filter pills' current one is ?filter=.
  return <KitPage tab={typeof tab === "string" ? tab : ""} filter={typeof filter === "string" ? filter : ""} today={tanzaniaToday()} />
}
