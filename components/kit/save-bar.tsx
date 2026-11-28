"use client"

import { Icon } from "@/components/icons"

import { Button } from "./button"

import "./kit.css"

export type SaveBarProps = {
  /** How many changes wait, as a sentence: "3 changes not saved". Read out when it changes. */
  message: string
  /** The region's name for a screen reader, such as "Unsaved changes". */
  label: string
  undoLabel: string
  saveLabel: string
  /** The Save button's words while the save runs, such as "Saving…". */
  savingLabel: string
  saving?: boolean
  onUndo: () => void
  onSave: () => void
}

/**
 * The bottom edge of a card where people change many things and save once
 * (DESIGN.md, Save bar). Pass it as a filling Card's `foot` while something
 * differs from what's saved, and leave it out otherwise: the card's content
 * scrolls above it, so it never covers a field. An orange Save and a ghost
 * Undo; on a phone the two share the full width.
 */
export function SaveBar({ message, label, undoLabel, saveLabel, savingLabel, saving, onUndo, onSave }: SaveBarProps) {
  return (
    <div className="kit-savebar" role="region" aria-label={label}>
      <p className="kit-savebar-text" aria-live="polite">
        <Icon name="alert" size={18} />
        {message}
      </p>
      <div className="kit-savebar-acts">
        <Button variant="ghost" size="small" disabled={saving} onClick={onUndo}>
          {undoLabel}
        </Button>
        <Button size="small" pending={saving} onClick={onSave}>
          {saving ? savingLabel : saveLabel}
        </Button>
      </div>
    </div>
  )
}
