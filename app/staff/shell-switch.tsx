"use client"

import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"

import { lookFor } from "./route-looks"
import type { ShellProps } from "./shell-types"

// Each shell is its own chunk, so a page downloads only the one it is drawn in.
const LegacyShell = dynamic(() => import("./_shell/staff-shell").then((m) => m.LegacyShell))
const NewShell = dynamic(() => import("./_new-shell/new-shell").then((m) => m.NewShell))

/**
 * The chrome around every staff page: the new shell for a route
 * app/staff/route-looks.ts marks "new", the old one for the rest. The
 * layout never learns the path on a client navigation, so the choice is made
 * here, in the browser, from the exact route pattern.
 */
export function StaffShell(props: ShellProps) {
  const look = lookFor(usePathname())
  return look === "new" ? <NewShell {...props} /> : <LegacyShell {...props} />
}
