"use client"

// The error, forbidden and not-found pages in the new look. page-states.tsx
// loads this file only on a route the new shell holds.

import { Button, ButtonLink } from "@/components/kit/button"
import { PageHeader } from "@/components/kit/page-header"


/** A staff page that has nothing to show (forbidden or missing), in the new look: what happened, and the way back. */
export function NewLookNotice({ title, text }: { title: string; text: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={text} />
      <div className="ns-state-act">
        <ButtonLink href="/staff">Back to the staff area</ButtonLink>
      </div>
    </>
  )
}

/** A staff page that failed to render, in the new look. The error's own message is never shown. */
export function NewLookError({ title, text, digest, retry }: { title: string; text: string; digest?: string; retry: () => void }) {
  return (
    <>
      <PageHeader title={title} subtitle={text} />
      <div className="ns-state-act">
        <Button onClick={() => retry()}>Try again</Button>
        <ButtonLink variant="ghost" href="/staff">
          Back to the staff area
        </ButtonLink>
      </div>
      {digest && <p className="ns-state-ref">Reference: {digest}</p>}
    </>
  )
}
