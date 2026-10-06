import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { getReApplication, type ReApplication, type ReApplicationField } from "@/lib/services/re-applications"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { differingText, displayPhone, FIELD_LABELS, when } from "../format"
import { LeadBadges } from "../lead-badges"
import { MarkReviewed } from "./mark-reviewed"

export const metadata: Metadata = {
  title: "Re-application · Al-Rahmah Complex",
}

// One re-application: the lead it names, what the family sent, and whether
// anyone has reviewed it. Staff with leads.edit mark it reviewed here, on a
// closed lead too, since the review changes the re-application, not the lead.
export default async function ReApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const { id } = await params
  const reApplication = await getReApplication(await createClient(), id)
  if (!reApplication.ok && reApplication.error === "not-found") notFound()
  if (!reApplication.ok) {
    return (
      <Alert variant="destructive">
        <AlertDescription>This re-application could not be loaded. Try again in a moment.</AlertDescription>
      </Alert>
    )
  }

  const entry = reApplication.data
  const canReview = entry.reviewedAt === null && staff.permissions.includes("leads.edit")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/staff/re-applications" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Re-applications
        </Link>
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Re-application</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/staff/leads/${entry.leadId}`}
            className="font-mono text-sm font-medium text-blue-600 underline-offset-4 hover:underline"
          >
            {entry.admissionNumber}
          </Link>
          <span className="text-sm font-medium text-slate-900">{entry.studentName}</span>
          <LeadBadges status={entry.status} closure={entry.closure} />
        </div>
        <p className="text-sm text-muted-foreground">
          Arrived <time dateTime={entry.receivedAt}>{when(entry.receivedAt)}</time> from the Admission form.{" "}
          {differingText(entry.differingFields.length)} from the lead.
        </p>
      </div>

      <section aria-labelledby="re-application-review" className="flex flex-col gap-2">
        <h2 id="re-application-review" className="text-sm font-semibold text-slate-900">
          Review
        </h2>
        {entry.reviewedAt ? (
          <p className="text-sm text-slate-900">
            Reviewed by {entry.reviewedBy ?? "Unknown"} on <time dateTime={entry.reviewedAt}>{when(entry.reviewedAt)}</time>
          </p>
        ) : (
          <p className="text-sm text-slate-900">Not reviewed yet.</p>
        )}
        {canReview && <MarkReviewed reApplicationId={entry.id} />}
      </section>

      <Submitted entry={entry} />
    </div>
  )
}

// What the family sent, field by field, each one that differed from the lead
// when it arrived marked so.
function Submitted({ entry }: { entry: ReApplication }) {
  const sent = entry.submitted
  const differs = new Set(entry.differingFields)
  const relationship = sent.relationshipDescription ? `${sent.relationship}: ${sent.relationshipDescription}` : sent.relationship

  // A number shows as stored, with what the family typed beneath it when
  // that reads differently.
  const typed = (asSent: string | null, shown: string) => (asSent && asSent !== shown ? asSent : null)

  const rows: { field: ReApplicationField; value: string; typedAs?: string | null }[] = [
    { field: "student_name", value: sent.studentName },
    { field: "class_name", value: sent.className },
    { field: "enrollment_year", value: String(sent.enrollmentYear) },
    { field: "day_or_boarding", value: sent.dayOrBoarding },
    { field: "contact_name", value: sent.contactName },
    { field: "relationship", value: relationship },
    { field: "phone", value: displayPhone(sent.phone), typedAs: typed(sent.phoneAsSent, displayPhone(sent.phone)) },
    {
      field: "whatsapp",
      value: sent.whatsapp ? displayPhone(sent.whatsapp) : "Same as phone",
      typedAs: typed(sent.whatsappAsSent, sent.whatsapp ? displayPhone(sent.whatsapp) : ""),
    },
  ]

  return (
    <section aria-labelledby="re-application-sent" className="flex flex-col gap-2">
      <h2 id="re-application-sent" className="text-sm font-semibold text-slate-900">
        What the family sent
      </h2>
      <dl className="grid max-w-xl grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-xl p-4 text-sm ring-1 ring-foreground/10">
        {rows.map(({ field, value, typedAs }) => {
          // The description shows with the relationship, so either differing
          // marks the one row.
          const different = differs.has(field) || (field === "relationship" && differs.has("relationship_description"))
          return (
            <div key={field} className="contents">
              <dt className="text-muted-foreground">{FIELD_LABELS[field]}</dt>
              <dd className="flex flex-wrap items-center gap-2 break-words text-slate-900">
                {value}
                {different && (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                    Differs
                  </Badge>
                )}
                {typedAs && <span className="w-full text-xs text-muted-foreground">Typed as {typedAs}</span>}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}
