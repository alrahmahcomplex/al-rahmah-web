import { cookies } from "next/headers"

import { StaffShell, type ShellItem } from "./_shell/staff-shell"
import { navCounts } from "./nav-counts"
import { navFor, STAFF_HOME } from "./navigation"
import { requireStaff } from "./session"
import { SIDEBAR_RAIL_COOKIE } from "./shell-cookies"

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()
  const [counts, cookieStore] = await Promise.all([navCounts(staff), cookies()])

  // The icons are rendered here: an icon component can't be handed to the
  // client shell, but what it renders can.
  const items: ShellItem[] = [STAFF_HOME, ...navFor(staff.permissions)].map((entry) => {
    const Icon = entry.icon
    return {
      href: entry.href,
      label: entry.label,
      group: entry.group,
      icon: <Icon aria-hidden="true" />,
      count: counts[entry.href],
    }
  })

  return (
    <StaffShell
      items={items}
      initialCollapsed={cookieStore.get(SIDEBAR_RAIL_COOKIE)?.value === "1"}
      person={{ name: staff.name, roleName: staff.roleName }}
    >
      {children}
    </StaffShell>
  )
}
