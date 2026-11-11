"use client"

import { useEffect, useRef, type ReactNode } from "react"

import { ProgressBar, type ProgressBarProps } from "@/components/guided-form/progress-bar"
import { cn } from "@/lib/utils"

import { TaskCard } from "./card"
import { rainConfetti } from "./confetti"
import { FinishedState, type FinishedResult } from "./states"
import "./kit.css"

export type GuidedTaskFinished = {
  title: ReactNode
  hint?: ReactNode
  /** Each Admission Number on a Lavender Whisper row. */
  results?: FinishedResult[]
  /** Notes, then the next actions. */
  children?: ReactNode
}

export type GuidedTaskProps = {
  /** The progress bar, with English labels: `labels={{ back: "Back", reset: "Start over" }}`. */
  progress: Omit<ProgressBarProps, "kitIcons" | "cheerDelay">
  /** The questions: a `GuidedStack` from the guided form. */
  children: ReactNode
  /** Set once the task is saved: the card shows the Finished screen instead, and the confetti rains. */
  finished?: GuidedTaskFinished | null
  className?: string
}

/**
 * The guided form on a staff page (DESIGN.md, Guided form): one lifted task
 * card in a 640px centred column, the progress bar sticky at the top of the
 * stage's scroll area, then the questions. When `finished` is set, the card
 * gives way to the Finished screen; its title takes focus and the confetti
 * rains once. Set it 950ms after the save, so the last group's cheer plays first.
 *
 * The bar sticks to the top of the nearest scroll area. A staff stage whose
 * scroll area is padded sets `--kit-stage-pt` to that top padding, so the bar
 * sits flush with the stage's top edge, and marks itself `data-stage-scroll`,
 * so `revealStep` scrolls it instead of the window.
 */
export function GuidedTask({ progress, children, finished, className }: GuidedTaskProps) {
  return (
    <div className={cn("kit-guided", className)}>
      {finished ? (
        <FinishedCard finished={finished} />
      ) : (
        <TaskCard>
          {/* The prototype cheers a finished group at once, so the last group's cheer ends before the Finished screen. */}
          <ProgressBar {...progress} kitIcons cheerDelay={0} />
          {children}
        </TaskCard>
      )}
    </div>
  )
}

function FinishedCard({ finished }: { finished: GuidedTaskFinished }) {
  const card = useRef<HTMLElement>(null)
  const rained = useRef(false)

  useEffect(() => {
    card.current?.querySelector<HTMLElement>(".kit-done-title")?.focus()
    if (rained.current) return
    rained.current = true
    rainConfetti()
  }, [])

  return (
    <TaskCard ref={card}>
      <FinishedState title={finished.title} hint={finished.hint} results={finished.results}>
        {finished.children}
      </FinishedState>
    </TaskCard>
  )
}

/**
 * Part of an open question that unfolds once the answers before it allow
 * (the prototype's `.rv`): a field after a choice, Continue once the
 * question is complete. Closed, it takes no space and Tab skips it.
 */
export function GuidedReveal({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("kit-rv", className)} data-open={open ? "" : undefined} inert={!open || undefined}>
      <div>{children}</div>
    </div>
  )
}
