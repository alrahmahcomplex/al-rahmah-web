"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"

import { NewLookError } from "./_new-shell/page-states"
import { lookFor } from "./route-looks"

const TITLE = "This page could not be shown"
const TEXT = "Something went wrong while loading it. Try again; if it keeps happening, tell the Super Admin the reference below."

// A staff page that failed to render, shown inside the shell so the sidebar
// still works, in the look of the shell around it. Try again re-fetches the
// page; the reference is the digest the server logged, for staff to quote
// when they report it. The error's message is never shown, as it may carry
// details.
export default function StaffError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const look = lookFor(usePathname())
  useEffect(() => {
    console.error(error)
  }, [error])

  if (look === "new") return <NewLookError title={TITLE} text={TEXT} digest={error.digest} retry={retry} />

  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="staff-heading">{TITLE}</h1>
      <p className="text-slate-700">{TEXT}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <Button variant="outline" render={<Link href="/staff" />} nativeButton={false}>
          Back to the staff area
        </Button>
      </div>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
    </div>
  )
}
