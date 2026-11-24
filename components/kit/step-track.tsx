import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./agents-parts.css"
import "./kit.css"

export type StepTrackState = "done" | "current" | "upcoming"

export type StepTrackItem = {
  key?: string
  label: string
  state: StepTrackState
}

/**
 * Vertical progress stepper (prototype v5, #539): numbered circles joined by
 * a vertical line; completed steps hold a green tick, the current step glows
 * orange, upcoming steps stay faint.
 */
export function StepTrack({ steps, label, className }: { steps: readonly StepTrackItem[]; label?: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn("kit-steps", className)}>
      {steps.map((step, index) => (
        <li
          key={step.key ?? step.label}
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className="kit-step-dot" aria-hidden="true">
            {step.state === "done" ? <Icon name="check" size={16} /> : index + 1}
          </span>
          <b className="kit-step-label">{step.label}</b>
        </li>
      ))}
    </ol>
  )
}
