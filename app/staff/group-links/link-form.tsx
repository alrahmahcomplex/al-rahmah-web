"use client"

import { useState, useTransition } from "react"
import { Button, Field } from "@/components/kit"
import type { SetGroupLinkError } from "@/lib/services/group-links"
import { saveGroupLink } from "./actions"
import "../agents/agents.css"

const errors: Record<SetGroupLinkError, string> = {
  forbidden: "You do not have permission to save group links.",
  "invalid-link": "Enter a WhatsApp group invite link beginning https://chat.whatsapp.com/.",
  "invalid-year": "Enter an Enrollment year from 2000 to 2999.",
  stale: "Someone changed this year's link. Reload the page before replacing it.",
  unavailable: "The group link could not be saved. Try again in a moment.",
}

export function LinkForm({ year, saved }: { year: number; saved: string | null }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  return (
    <form aria-label={`Group link ${year}`} className="ag-field ag-link-form" action={(form) => {
      startTransition(async () => {
        setMessage(null)
        try {
          const result = await saveGroupLink(year, String(form.get("link") ?? ""), saved)
          setMessage(result.ok ? { ok: true, text: "The group link is saved." } : { ok: false, text: errors[result.error] })
        } catch {
          setMessage({ ok: false, text: errors.unavailable })
        }
      })
    }}>
      <label htmlFor="group-link" className="ag-label">WhatsApp group link</label>
      <Field id="group-link" name="link" type="url" size="compact" alignStart required maxLength={200} defaultValue={saved ?? ""}
        placeholder="https://chat.whatsapp.com/…" aria-describedby="replace-note" disabled={pending} />
      <p id="replace-note" className="ag-hint">Replacing the link only affects new invitations. Families already invited still hold the earlier link.</p>
      {message && <p role={message.ok ? "status" : "alert"} className={message.ok ? "ag-p" : "ag-error"}>{message.text}</p>}
      <div><Button type="submit" pending={pending}>{pending ? "Saving…" : "Save link"}</Button></div>
    </form>
  )
}
