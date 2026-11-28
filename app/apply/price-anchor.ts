import { STANDARD_INTERVIEW_FEE } from "@/lib/referral-link"

import type { DiscountCodeCheck } from "./outcome"

// What the Discount code question's price box states on its green side
// (prototype WhJUMnd7XoaPF4XBmGcJja v3):
//
// - `code`: a confirmed code that takes money off. The box shows that code's
//   own saving, so it always matches the "Well done" line under the field.
// - `range`: before that, when the codes that work today give different
//   amounts: the lowest and highest saving.
// - `one`: one saving, when every working code gives the same amount, or the
//   range could not be read and the standard amount could.
// - null: nothing known yet. The box shows the full fee alone.

export type AnchorFigures =
  | { kind: "code"; saving: number }
  | { kind: "range"; lowest: number; highest: number }
  | { kind: "one"; saving: number }
  | null

/** What a checked code takes off per student: zero unless it is confirmed. */
export function codeSaving(answer: DiscountCodeCheck | null): number {
  if (!answer || answer.status !== "approved") return 0
  return Math.max(0, STANDARD_INTERVIEW_FEE - answer.amount)
}

export function anchorFigures({
  answer,
  checking,
  standard,
  lowest,
  highest,
}: {
  /** The answer for the code in the field, or null when it has none. */
  answer: DiscountCodeCheck | null
  /** A check is running, so the answer may be about to change. */
  checking: boolean
  /** The standard amount from the live route, or null. */
  standard: number | null
  /** The smallest and largest saving a working code gives now, or null. */
  lowest: number | null
  highest: number | null
}): AnchorFigures {
  const saving = checking ? 0 : codeSaving(answer)
  if (saving > 0) return { kind: "code", saving }
  if (lowest !== null && highest !== null && lowest > 0 && highest >= lowest) {
    return lowest === highest ? { kind: "one", saving: lowest } : { kind: "range", lowest, highest }
  }
  if (standard !== null && standard > 0) return { kind: "one", saving: standard }
  return null
}
