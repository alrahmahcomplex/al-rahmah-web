"use client"

import { useState, useTransition } from "react"

import { Button, Card, Note } from "@/components/kit"
import type { Notice } from "@/lib/services/staff-admin"

import { dismissMyNotices } from "../actions"

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
    <Card title="Changes to your account" titleId="notices-heading">
      <ul className="td-notices">
        {notices.map((notice) => (
          <li key={notice.id}>{notice.message}</li>
        ))}
      </ul>
      <div className="td-notices-act">
        <Button variant="ghost" size="small" onClick={dismiss} pending={pending}>
          Dismiss
        </Button>
        {failed && (
          <Note tone="bad" role="alert">
            These couldn&apos;t be dismissed. Try again in a moment.
          </Note>
        )}
      </div>
    </Card>
  )
}
