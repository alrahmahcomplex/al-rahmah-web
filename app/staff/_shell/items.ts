import type { ReactNode } from "react"

import type { NavCount } from "../nav-counts"
import type { StaffNavGroup } from "../navigation"

// One destination in the shell, as the layout hands it over: the entry the
// staff member may see, its icon already rendered, and the count waiting there.
export type ShellItem = { href: string; label: string; group: StaffNavGroup; icon: ReactNode; count?: NavCount }

export type ShellPerson = { name: string; roleName: string }
