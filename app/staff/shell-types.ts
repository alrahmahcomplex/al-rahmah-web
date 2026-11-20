import type { ReactNode } from "react"

import type { IconName } from "@/components/icons"

import type { StaffNavGroup } from "./navigation"

// What app/staff/layout.tsx hands the shell.

// One destination: an entry the staff member may see, with its icon by name.
// No count: the bell is the only one (The One Pip Rule).
export type ShellItem = { href: string; label: string; group: StaffNavGroup; iconName: IconName }

export type ShellPerson = { name: string; roleName: string }

// The bell: shown only to staff who may decide a Discount or a Reopening
// request, with how many such requests are Pending. Null hides it.
export type ShellBell = { pending: number } | null

export type ShellProps = {
  items: ShellItem[]
  person: ShellPerson
  bell: ShellBell
  /** The sidebar folded to its icons when the document loads, from the rail cookie. */
  folded: boolean
  /** The sidebar's open width when the document loads, from its cookie, clamped on the server; null for the narrowest. */
  sidebarWidth: number | null
  /** Whether the top bar's search may open Applicants. */
  canSearch: boolean
  children: ReactNode
}
