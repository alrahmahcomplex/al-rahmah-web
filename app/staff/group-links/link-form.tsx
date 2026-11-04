"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SetGroupLinkError } from "@/lib/services/group-links"
import { saveGroupLink } from "./actions"

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
    <form aria-label={`Group link ${year}`} className="flex max-w-xl flex-col gap-3" action={(form) => {
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
      <Label htmlFor="group-link">WhatsApp group link</Label>
      <Input id="group-link" name="link" type="url" required maxLength={200} defaultValue={saved ?? ""}
        placeholder="https://chat.whatsapp.com/…" aria-describedby="replace-note" disabled={pending} />
      <p id="replace-note" className="text-sm text-muted-foreground">Replacing the link only affects new invitations. Families already invited still hold the earlier link.</p>
      {message && <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-foreground" : "text-destructive"}`}>{message.text}</p>}
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : "Save link"}</Button>
    </form>
  )
}
