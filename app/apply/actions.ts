"use server"

import { headers } from "next/headers"

import { admissionYears, parseAdmissionForm } from "@/lib/admission-form"
import { checkPublicFormLimit } from "@/lib/rate-limit"
import { submitAdmissionForm as saveAdmissionForm } from "@/lib/services/admission-form"
import { verifyTurnstile } from "@/lib/turnstile"
import { publicFormClient } from "@/utils/supabase/public-form"

import type { AdmissionFormState } from "./outcome"

// Sends the public Admission form. In this order, so nothing is written
// unless both checks pass: the rate limit, Turnstile, the form's own checks,
// then the admission-form service.
export async function submitAdmissionForm(
  _previous: AdmissionFormState,
  formData: FormData,
): Promise<AdmissionFormState> {
  const requestHeaders = await headers()

  if ((await checkPublicFormLimit({ headers: requestHeaders, key: "admission" })) === "limited") {
    return { status: "rate-limited" }
  }

  const check = await verifyTurnstile({
    token: formData.get("cf-turnstile-response"),
    action: "admission",
    remoteIp: requestHeaders.get("x-real-ip"),
    hostname: requestHeaders.get("host"),
  })
  if (!check.ok) return { status: "check-failed" }

  const parsed = parseAdmissionForm(formData.get("form"), admissionYears())
  if (!parsed.ok) return { status: "invalid", ...parsed.error }

  let supabase
  try {
    supabase = publicFormClient()
  } catch (error) {
    console.error("Admission form: Supabase is not configured", error)
    return { status: "unavailable" }
  }
  if (!supabase) return { status: "unavailable" }

  let saved
  try {
    saved = await saveAdmissionForm(supabase, parsed.data)
  } catch (error) {
    console.error("Admission form: saving failed", error)
    return { status: "unavailable" }
  }
  if (saved.ok) return { status: "confirmed", children: saved.data }
  switch (saved.error.kind) {
    case "invalid":
      return { status: "invalid", field: saved.error.field, child: saved.error.child }
    case "already-sent":
      return { status: "already-sent", children: saved.error.children }
    case "unavailable":
      return { status: "unavailable" }
  }
}
