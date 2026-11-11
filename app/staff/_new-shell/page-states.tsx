"use client"

import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { lookFor } from "../route-looks"

// The error, forbidden and not-found pages load with every staff page, the
// old shell's too, so their new look is a chunk of its own, fetched only on
// a route the new shell holds.
const NewLookNotice = dynamic(() => import("./page-states-new").then((m) => m.NewLookNotice))
export const NewLookError = dynamic(() => import("./page-states-new").then((m) => m.NewLookError))

/** A staff page with nothing to show, in the look of the shell around it: the new look on a route the new shell holds, `legacy` elsewhere. */
export function NoticeByLook({ title, text, legacy }: { title: string; text: string; legacy: ReactNode }) {
  return lookFor(usePathname()) === "new" ? <NewLookNotice title={title} text={text} /> : legacy
}
