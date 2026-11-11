import { cookies } from "next/headers"

import { MotionProvider } from "@/components/motion-provider"
import { managesStaff } from "@/lib/services/staff-auth"

import { BELL_SCREENS } from "./bell-screens"
import { bellPending, navCounts } from "./nav-counts"
import { navFor, STAFF_HOME } from "./navigation"
import { requireStaff } from "./session"
import { parseSidebarCookies, SIDEBAR_RAIL_COOKIE, SIDEBAR_WIDTH_COOKIE } from "./shell-cookies"
import { StaffShell } from "./shell-switch"
import type { ShellBell, ShellItem } from "./shell-types"

// Signs the staff member in, reads what the shells need (the entries they
// may see, the counts, the sidebar cookies) and hands it to the client
// switch, which draws the old or the new shell for the current route
// (app/staff/route-looks.ts). The cookies are read here and nowhere above
// (ADR 0006).
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()
  const [counts, cookieStore] = await Promise.all([navCounts(staff), cookies()])
  const sidebar = parseSidebarCookies(cookieStore.get(SIDEBAR_RAIL_COOKIE)?.value, cookieStore.get(SIDEBAR_WIDTH_COOKIE)?.value)

  // The icons are rendered here: an icon component can't be handed to the
  // client shell, but what it renders can.
  const entries = [STAFF_HOME, ...navFor(staff.permissions, undefined, { managesStaff: managesStaff(staff) })]
  const items: ShellItem[] = entries.map((entry) => {
    const Icon = entry.icon
    return {
      href: entry.href,
      label: entry.label,
      group: entry.group,
      icon: <Icon aria-hidden="true" />,
      iconName: entry.iconName,
      count: counts[entry.href],
    }
  })

  // The bell is for whoever may open a request screen, and counts what waits there.
  const bellScreens = entries.filter((entry) => BELL_SCREENS.includes(entry.href))
  const bell: ShellBell = bellScreens.length
    ? { pending: await bellPending(staff, bellScreens.map((entry) => entry.href), counts) }
    : null

  return (
    <MotionProvider>
      <StaffShell
        items={items}
        person={{ name: staff.name, roleName: staff.roleName }}
        bell={bell}
        folded={sidebar.folded}
        sidebarWidth={sidebar.width}
        canSearch={entries.some((entry) => entry.href === "/staff/applicants")}
      >
        {children}
      </StaffShell>
    </MotionProvider>
  )
}
