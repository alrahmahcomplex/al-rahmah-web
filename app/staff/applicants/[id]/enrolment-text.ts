import type { Enrolment } from "@/lib/services/lead-fees"
import { PAYMENT_TYPE_NAMES } from "@/lib/services/school-fee-payments"

import { formatShillings } from "../../fees/format"

// What enrolled a lead, in words for the School fee section: the payment that
// took it over the line, or its year's Academic-year start.
export function enrolledBy(enrolment: Enrolment): string {
  if (enrolment.by.kind === "academic-year-start") return "By the Academic-year start"
  const type = PAYMENT_TYPE_NAMES[enrolment.by.type]
  if (enrolment.by.amount === null) return `By ${type}`
  return `By the ${type} of TZS ${formatShillings(enrolment.by.amount)}`
}
