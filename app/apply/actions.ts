"use server"

import { headers } from "next/headers"

import { admissionYears, parseAdmissionForm } from "@/lib/admission-form"
import { checkPublicFormLimit } from "@/lib/rate-limit"
import { normalizeDiscountCode } from "@/lib/referral-link"
import { submitAdmissionForm as saveAdmissionForm } from "@/lib/services/admission-form"
import { estimateDiscountCode } from "@/lib/services/referral"
import { verifyTurnstile } from "@/lib/turnstile"
import { publicFormClient } from "@/utils/supabase/public-form"

import type { AdmissionFormState, DiscountCodeCheck } from "./outcome"

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
      return { status: "already-sent", children: saved.error.children, complete: saved.error.complete }
    case "unavailable":
      return { status: "unavailable" }
  }
}

// Checks a Discount code typed on the review step, for the note under the
// field and the fee. It writes nothing, so it runs without Turnstile, but
// under the rate limit, so nobody can list every code cheaply. A value that
// isn't a code is looked up as no code at all, so it comes back `unknown`
// with the standard fee.
export async function checkDiscountCode(code: unknown): Promise<DiscountCodeCheck> {
  if ((await checkPublicFormLimit({ headers: await headers(), key: "code-check" })) === "limited") {
    return { status: "rate-limited" }
  }

  const normalized = normalizeDiscountCode(code)
  let supabase
  try {
    supabase = publicFormClient()
  } catch (error) {
    console.error("Discount code check: Supabase is not configured", error)
    return { status: "unavailable" }
  }
  if (!supabase) return { status: "unavailable" }

  let estimate
  try {
    estimate = await estimateDiscountCode(supabase, normalized ?? "")
  } catch (error) {
    console.error("Discount code check failed", error)
    return { status: "unavailable" }
  }
  if (!estimate.ok) return { status: "unavailable" }
  return { status: estimate.data.state, amount: estimate.data.amount }
}
