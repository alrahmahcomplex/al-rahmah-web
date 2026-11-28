"use client"

import { useState } from "react"

import { Card, Checkbox, SaveBar, Tag, toast } from "@/components/kit"

// The save bar (Roles save once, prototype VthmqWypofP6y4c9ZpY2uL v3), built
// in components/kit/ and shown here before a screen uses it (DESIGN.md, The
// Kit First Rule). Fixture data only.

const BOXES = [
  { id: "decline", label: "Decline applicants", saved: false },
  { id: "results", label: "Send interview results", saved: true },
  { id: "reports", label: "View reports", saved: false },
  { id: "visits", label: "Record campus visits", saved: true },
  { id: "follow", label: "Add and complete follow-ups", saved: true },
  { id: "fees", label: "View school-fee payments", saved: true },
] as const

export function SaveBarCard() {
  const [saved, setSaved] = useState<Record<string, boolean>>(() => Object.fromEntries(BOXES.map((b) => [b.id, b.saved])))
  const [shown, setShown] = useState(saved)
  const [saving, setSaving] = useState(false)
  const count = BOXES.filter((b) => shown[b.id] !== saved[b.id]).length

  return (
    <Card id="save-bar" title="Save bar" data-bento="full">
      <p className="kp-spec">
        A filling card (<code>Card fill</code>) takes the height it is given and scrolls its content inside. While something differs
        from what&apos;s saved, the <code>SaveBar</code> is its <code>foot</code>: the bottom edge of the card, never over a field.
        Select a box below.
      </p>
      <div className="kp-savebar-demo">
        <Card
          fill
          title="Primary Secretary"
          foot={
            count > 0 && (
              <SaveBar
                label="Unsaved changes"
                message={`${count} change${count === 1 ? "" : "s"} not saved`}
                undoLabel="Undo changes"
                saveLabel="Save changes"
                savingLabel="Saving…"
                saving={saving}
                onUndo={() => setShown(saved)}
                onSave={() => {
                  setSaving(true)
                  setTimeout(() => {
                    setSaved(shown)
                    setSaving(false)
                    toast(`Saved ${count} change${count === 1 ? "" : "s"}.`, { tone: "good" })
                  }, 900)
                }}
              />
            )
          }
        >
          <ul className="kp-savebar-list">
            {BOXES.map((box) => {
              const on = shown[box.id]
              return (
                <li key={box.id}>
                  <Checkbox
                    label={box.label}
                    checked={on}
                    disabled={saving}
                    onCheckedChange={(next) => setShown((s) => ({ ...s, [box.id]: next }))}
                  />
                  {on !== saved[box.id] && <Tag tone={on ? "ok" : "bad"}>{on ? "Added" : "Removed"}</Tag>}
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
      <p className="kp-spec">
        The count says how many boxes differ from what&apos;s saved, so selecting and clearing the same box adds nothing. A changed box
        gets an <b>Added</b> or <b>Removed</b> Tag. On a phone the two buttons share the full width.
      </p>
    </Card>
  )
}
