"use client"

import { BellIcon } from "lucide-react"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import type { Notice } from "@/lib/services/staff-admin"

import { dismissMyNotices } from "./actions"

// Changes someone else made to the signed-in person's role or account since
// they last dismissed them, oldest first. Dismiss clears them through the
// newest one shown, so a change that arrives meanwhile shows next time.
export function Notices({ notices }: { notices: Notice[] }) {
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  if (notices.length === 0) return null
  const newest = notices[notices.length - 1]

  function dismiss() {
    startTransition(async () => {
      const outcome = await dismissMyNotices(newest.id)
      setFailed(!outcome.ok)
    })
  }

  return (
    <section aria-labelledby="notices-heading" className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm">
      <h2 id="notices-heading" className="flex items-center gap-2 font-medium">
        <BellIcon aria-hidden className="size-4 text-muted-foreground" />
        Changes to your account
      </h2>
      <ul className="flex flex-col gap-1.5">
        {notices.map((notice) => (
          <li key={notice.id}>{notice.message}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={dismiss} disabled={pending}>
          Dismiss
        </Button>
        {failed && (
          <p role="alert" className="text-destructive">
            These couldn&apos;t be dismissed. Try again in a moment.
          </p>
        )}
      </div>
    </section>
  )
}
