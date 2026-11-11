"use client"

import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { lookFor } from "./route-looks"
import type { ShellProps } from "./shell-types"

// Each shell is its own chunk, so a page downloads only the one it is drawn in.
const LegacyShell = dynamic(() => import("./_shell/staff-shell").then((m) => m.LegacyShell))
const NewShell = dynamic(() => import("./_new-shell/new-shell").then((m) => m.NewShell))

/**
 * The chrome around every staff page: the new shell for a route
 * app/staff/route-looks.ts marks "new", the old one for the rest. The
 * layout never learns the path on a client navigation, so the choice is made
 * here, in the browser, from the exact route pattern. The switch outlives
 * both shells, so it keeps the sidebar preferences and knows whether the
 * person has navigated since the document loaded.
 */
export function StaffShell(props: ShellProps) {
  const pathname = usePathname()
  const [folded, setFolded] = useState(props.folded)
  const [sidebarWidth, setSidebarWidth] = useState(props.sidebarWidth)
  const [firstPath] = useState(pathname)
  const [navigated, setNavigated] = useState(false)
  if (!navigated && pathname !== firstPath) setNavigated(true)

  const view = { ...props, folded, sidebarWidth, navigated, onFoldedChange: setFolded, onSidebarWidthChange: setSidebarWidth }
  return lookFor(pathname) === "new" ? <NewShell {...view} /> : <LegacyShell {...view} />
}
