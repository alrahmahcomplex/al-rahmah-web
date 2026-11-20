"use client"

import { useEffect } from "react"

import { PageError } from "./_new-shell/page-states"

// A staff page that failed to render, shown inside the shell so the sidebar
// still works. Try again re-fetches the page; the reference is the digest the
// server logged, for staff to quote when they report it. The error's message
// is never shown, as it may carry details.
export default function StaffError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <PageError
      title="This page could not be shown"
      text="Something went wrong while loading it. Try again; if it keeps happening, tell the Super Admin the reference below."
      digest={error.digest}
      retry={retry}
    />
  )
}
