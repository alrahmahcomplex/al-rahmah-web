import type { Metadata } from "next"
import { cookies } from "next/headers"

import { MotionProvider } from "@/components/motion-provider"
import { managesStaff } from "@/lib/services/staff-auth"

import { BELL_SCREENS } from "./bell-screens"
import { bellPending, navCounts } from "./nav-counts"
import { navFor, STAFF_HOME } from "./navigation"
import { requireStaff } from "./session"
import { parseSidebarCookies, SIDEBAR_RAIL_COOKIE, SIDEBAR_WIDTH_COOKIE } from "./shell-cookies"
import { NewShell } from "./_new-shell/new-shell"
import type { ShellBell, ShellItem } from "./shell-types"

// Kept out of search results. The not-found and forbidden notices are drawn by
// the pages themselves, so Next.js no longer marks them (#437, #441).
export const metadata: Metadata = { robots: { index: false } }

// Signs the staff member in, reads what the shell needs (the entries they
// may see, the bell's count, the sidebar cookies) and hands it to the shell.
// The cookies are read here and nowhere above (ADR 0006).
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()
  const [counts, cookieStore] = await Promise.all([navCounts(staff), cookies()])
  const sidebar = parseSidebarCookies(cookieStore.get(SIDEBAR_RAIL_COOKIE)?.value, cookieStore.get(SIDEBAR_WIDTH_COOKIE)?.value)

  const entries = [STAFF_HOME, ...navFor(staff.permissions, undefined, { managesStaff: managesStaff(staff) })]
  const items: ShellItem[] = entries.map(({ href, label, group, iconName }) => ({ href, label, group, iconName }))

  // The bell is for whoever may open a request screen, and counts what waits there.
  const bellScreens = entries.filter((entry) => BELL_SCREENS.includes(entry.href))
  const bell: ShellBell = bellScreens.length
    ? { pending: await bellPending(staff, bellScreens.map((entry) => entry.href), counts) }
    : null

  return (
    <MotionProvider>
      <NewShell
        items={items}
        person={{ name: staff.name, roleName: staff.roleName }}
        bell={bell}
        folded={sidebar.folded}
        sidebarWidth={sidebar.width}
        canSearch={entries.some((entry) => entry.href === "/staff/applicants")}
      >
        {children}
      </NewShell>
    </MotionProvider>
  )
}
