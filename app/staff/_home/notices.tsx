"use client"

import { useState, useTransition } from "react"

import { Button, Note } from "@/components/kit"
import type { Notice } from "@/lib/services/staff-admin"

import { dismissMyNotices } from "../actions"

// Changes someone else made to the signed-in person's role or account since
// they last dismissed them, oldest first, in a note above Home's top row
// until they have a prototyped place (#323). Dismiss clears them through the
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
    <section aria-labelledby="notices-heading" className="hm-notices">
      <Note icon="bell">
        <b id="notices-heading" className="hm-notices-title">
          Changes to your account
        </b>
        <span role="list" className="hm-notices-list">
          {notices.map((notice) => (
            <span role="listitem" key={notice.id}>
              {notice.message}
            </span>
          ))}
        </span>
        <span className="hm-notices-act">
          <Button variant="ghost" size="small" pending={pending} onClick={dismiss}>
            Dismiss
          </Button>
          {failed && <span role="alert">These couldn&apos;t be dismissed. Try again in a moment.</span>}
        </span>
      </Note>
    </section>
  )
}
