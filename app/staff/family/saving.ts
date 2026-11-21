"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import type { DayOrBoarding, LeadClass } from "@/lib/services/leads"

import { correctStudent } from "../applicants/[id]/actions"
import type { CorrectionOutcome } from "../applicants/[id]/correction-outcome"

// Saving on the Family page (#512) goes through the lead record's own
// Server Actions, permissions and audit. They refresh the record's page, so
// the Family page refreshes itself after each save.

export const LOST = "The change could not be confirmed. Check your connection, reload the page and see whether it was saved."

/** What a refused correction says, in one sentence. */
export function refusalText(outcome: Exclude<CorrectionOutcome, { status: "saved" }>): string {
  return outcome.status === "duplicate"
    ? `This change would make the student a duplicate of ${outcome.admissionNumber}, which is already on file. Nothing was changed.`
    : outcome.message
}

export type StudentDetails = {
  leadId: string
  studentName: string
  className: LeadClass
  enrollmentYear: number
  dayOrBoarding: DayOrBoarding
}

/** One student's name, class or Day or boarding. Only that answer is sent, so one read earlier never overwrites a newer change to the others. */
export async function saveStudent(leadId: string, change: { studentName?: string; className?: LeadClass; dayOrBoarding?: DayOrBoarding }): Promise<CorrectionOutcome> {
  try {
    return await correctStudent(leadId, { fullName: change.studentName, className: change.className, dayOrBoarding: change.dayOrBoarding })
  } catch {
    return { status: "refused", field: null, message: LOST }
  }
}

/** A save in a sheet: pending while it runs, refreshing until router.refresh commits, its refusal kept to show. */
export function useSheetSave() {
  const router = useRouter()
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [refreshing, startRefresh] = useTransition()
  const refresh = () => startRefresh(() => router.refresh())
  // `refused` replaces showing the reason in the sheet, for a caller that says more.
  function run(save: () => Promise<CorrectionOutcome>, done: () => void, refused?: (reason: string) => void) {
    setProblem(null)
    startTransition(async () => {
      const outcome = await save()
      if (outcome.status !== "saved") return refused ? refused(refusalText(outcome)) : setProblem(refusalText(outcome))
      done()
      refresh()
    })
  }
  return { problem, setProblem, pending, refreshing, run, refresh }
}
