"use client"

import { useState } from "react"

import { TabSwitch } from "./tabs"
import "./kit.css"

export type ClassLevel<C extends string> = { label: string; classes: readonly C[] }

/**
 * The class sheet's body (DESIGN.md, Components): the school levels on a
 * sliding track, then the level's classes as big tiles, the picked one
 * filled indigo. It opens on the level that holds `picked`, else on
 * `defaultLevel`. Put it in a `Sheet`; `onPick` gets the class pressed.
 */
export function ClassPicker<C extends string>({
  label,
  levels,
  picked,
  defaultLevel = 0,
  onPick,
}: {
  /** Names the levels' tablist, such as "School level". */
  label: string
  levels: readonly ClassLevel<C>[]
  picked?: C | null
  defaultLevel?: number
  onPick: (cls: C) => void
}) {
  const [level, setLevel] = useState(() => {
    const at = picked ? levels.findIndex((l) => l.classes.includes(picked)) : -1
    return String(at >= 0 ? at : defaultLevel)
  })
  return (
    <TabSwitch
      label={label}
      value={level}
      onChange={setLevel}
      tabs={levels.map((l, i) => ({
        value: String(i),
        label: l.label,
        panel: (
          <div className="kit-classes" data-n={l.classes.length}>
            {l.classes.map((cls) => (
              <button key={cls} type="button" className="kit-class" aria-pressed={cls === picked} onClick={() => onPick(cls)}>
                {cls}
              </button>
            ))}
          </div>
        ),
      }))}
    />
  )
}
