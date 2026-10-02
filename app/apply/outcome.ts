import type { FormField } from "@/lib/admission-form"

// What the Admission form is told after it sends. Small and stable: no raw
// error ever reaches the page.
export type AdmissionFormState =
  | { status: "idle" }
  | { status: "confirmed"; children: { fullName: string; admissionNumber: string }[] }
  // The form was sent before, then edited: the earlier send's children, whose
  // leads exist, and whether they were all of that send's children. The edits
  // are not saved.
  | { status: "already-sent"; children: { fullName: string; admissionNumber: string }[]; complete: boolean }
  | { status: "rate-limited" }
  | { status: "check-failed" }
  | { status: "invalid"; field: FormField; child: number | null }
  | { status: "unavailable" }

export const IDLE: AdmissionFormState = { status: "idle" }
