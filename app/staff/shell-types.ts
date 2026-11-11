import type { ReactNode } from "react"

import type { IconName } from "@/components/icons"

import type { NavCount } from "./nav-counts"
import type { StaffNavGroup } from "./navigation"

// What app/staff/layout.tsx hands the shell switch, for both shells.

// One destination: the entry the staff member may see, the old shell's icon
// already rendered, the new shell's icon by name, and the count the old
// shell shows beside it (the new one shows no counts, The One Pip Rule).
export type ShellItem = { href: string; label: string; group: StaffNavGroup; icon: ReactNode; iconName: IconName; count?: NavCount }

export type ShellPerson = { name: string; roleName: string }

// The new shell's bell: shown only to staff who may decide a Discount or a
// Reopening request, with how many such requests are Pending. Null hides it.
export type ShellBell = { pending: number } | null

export type ShellProps = {
  items: ShellItem[]
  person: ShellPerson
  bell: ShellBell
  /** The sidebar folded to its icons, from the rail cookie. */
  folded: boolean
  /** The new sidebar's open width from its cookie, clamped on the server; null for the narrowest. */
  sidebarWidth: number | null
  /** Whether the top bar's search may open Applicants. */
  canSearch: boolean
  children: ReactNode
}

// What the switch adds for the shell it draws. It owns the sidebar
// preferences, so a fold or a width set in one shell is still there when a
// link leads into the other.
export type ShellViewProps = ShellProps & {
  onFoldedChange: (folded: boolean) => void
  onSidebarWidthChange: (width: number | null) => void
  /** True once the person has moved from the page the document loaded on: the new page's stage then takes focus. */
  navigated: boolean
}
