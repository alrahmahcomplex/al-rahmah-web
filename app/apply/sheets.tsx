"use client"

import { CalendarDays, CircleAlert, Clock, User } from "lucide-react"
import { useState, type KeyboardEvent } from "react"

import { BottomSheet, ContinuePill } from "@/components/guided-form"
import { cn } from "@/lib/utils"

import type { FormCopy } from "./copy"
import { tzs } from "./questions"

// The bottom sheets on the Admission form: every class, by level, and the
// limited-time offer.

const LEVELS = [
  { id: "nursery", classes: ["DAY CARE", "KG 1", "KG 2"] },
  { id: "primary", classes: ["STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7"] },
  { id: "secondary", classes: ["FORM 1", "FORM 2", "FORM 3", "FORM 4"] },
] as const

type Level = (typeof LEVELS)[number]["id"]

function levelOf(className: string): Level {
  return LEVELS.find((level) => (level.classes as readonly string[]).includes(className))?.id ?? "primary"
}

/** Every class in three levels (tabs). One tap on a class answers and closes. */
export function ClassSheet({ copy, open, picked, onPick, onClose }: { copy: FormCopy; open: boolean; picked: string; onPick: (className: string) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState<Level | null>(null)
  const level = chosen ?? levelOf(picked)
  const index = LEVELS.findIndex((l) => l.id === level)
  const classes = LEVELS[index].classes

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const moves: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: LEVELS.length - 1 }
    if (!(event.key in moves)) return
    event.preventDefault()
    const next = LEVELS[(moves[event.key] + LEVELS.length) % LEVELS.length].id
    setChosen(next)
    document.getElementById(`class-tab-${next}`)?.focus()
  }

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        setChosen(null)
        onClose()
      }}
      title={copy.sheetTitle}
      closeLabel={copy.close}
    >
      <div role="tablist" className="relative grid grid-cols-3 rounded-full bg-blue-50 p-1">
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-1 w-[calc((100%-8px)/3)] rounded-full bg-blue-600 transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {LEVELS.map((l) => (
          <button
            key={l.id}
            id={`class-tab-${l.id}`}
            type="button"
            role="tab"
            aria-selected={l.id === level}
            aria-controls="class-panel"
            tabIndex={l.id === level ? 0 : -1}
            onKeyDown={onTabKey}
            onClick={() => setChosen(l.id)}
            className={cn(
              "relative z-[1] min-h-11 rounded-full border-0 bg-transparent text-[15px] font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-blue-600/40",
              l.id === level ? "text-white" : "text-blue-600",
            )}
          >
            {copy.classGroups[l.id]}
          </button>
        ))}
      </div>
      <div id="class-panel" role="tabpanel" aria-labelledby={`class-tab-${level}`} className="min-h-[204px] pt-4">
        <div className={cn("grid gap-2.5", classes.length === 4 ? "grid-cols-2" : "grid-cols-3")}>
          {classes.map((className) => (
            <button
              key={className}
              type="button"
              aria-pressed={picked === className}
              onClick={() => {
                setChosen(null)
                onPick(className)
              }}
              className="min-h-14 rounded-2xl border-[1.5px] border-blue-600/22 bg-white px-1 text-[17px] font-bold text-slate-800 outline-none transition hover:border-blue-600/45 hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40 active:scale-[0.96] aria-pressed:border-blue-600 aria-pressed:bg-blue-600 aria-pressed:text-white max-[330px]:text-[15px]"
            >
              {className}
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}

/**
 * The limited-time offer: what the family saves, that the discount can be
 * withdrawn, the application count when it is shown, and to come this week.
 */
export function OfferSheet({
  copy,
  open,
  onClose,
  discountEach,
  students,
  applications,
}: {
  copy: FormCopy
  open: boolean
  onClose: () => void
  discountEach: number
  students: number
  // Already passed through shownApplicationCount: null leaves the line out.
  applications: string | null
}) {
  const words = copy.sheetOffer
  const icon = "mt-0.5 size-5 flex-none text-orange-700"
  return (
    <BottomSheet open={open} onClose={onClose} title={words.title} closeLabel={copy.close}>
      <p className="m-0 mb-3.5 rounded-[20px] bg-[#eefbf3] px-4 py-3.5 text-center text-base font-semibold text-[#0b5a2d]">
        {words.saved}
        <b className="block font-exo text-[26px] font-extrabold text-[#0f7a3d] italic">{tzs(discountEach * students)}</b>
      </p>
      <ul className="m-0 mb-[18px] flex list-none flex-col gap-3 p-0">
        <li className="flex items-start gap-3 text-[15px] leading-[1.45] text-slate-800">
          <Clock className={icon} aria-hidden />
          <span>{words.limited(tzs(discountEach))}</span>
        </li>
        <li className="flex items-start gap-3 text-[15px] leading-[1.45] text-slate-800">
          <CircleAlert className={icon} aria-hidden />
          <span>{words.withdrawn}</span>
        </li>
        {applications && (
          <li className="flex items-start gap-3 text-[15px] leading-[1.45] text-slate-800">
            <User className={icon} aria-hidden />
            <span>{words.applications(applications)}</span>
          </li>
        )}
        <li className="flex items-start gap-3 text-[15px] leading-[1.45] text-slate-800">
          <CalendarDays className={icon} aria-hidden />
          <span>{words.bring(students)}</span>
        </li>
      </ul>
      <ContinuePill onClick={onClose}>{words.ok}</ContinuePill>
    </BottomSheet>
  )
}
