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

/** One student's name, class or Day or boarding, with the rest sent as they are (the record's Edit student). */
export async function saveStudent(details: StudentDetails, change: Partial<Omit<StudentDetails, "leadId">>): Promise<CorrectionOutcome> {
  const next = { ...details, ...change }
  try {
    return await correctStudent(details.leadId, {
      fullName: next.studentName,
      className: next.className,
      enrollmentYear: next.enrollmentYear,
      dayOrBoarding: next.dayOrBoarding,
    })
  } catch {
    return { status: "refused", field: null, message: LOST }
  }
}

/** A save in a sheet: pending while it runs, its refusal kept to show. */
export function useSheetSave() {
  const router = useRouter()
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  function run(save: () => Promise<CorrectionOutcome>, done: () => void) {
    setProblem(null)
    startTransition(async () => {
      const outcome = await save()
      if (outcome.status !== "saved") return setProblem(refusalText(outcome))
      done()
      router.refresh()
    })
  }
  return { problem, setProblem, pending, run, refresh: () => router.refresh() }
}
