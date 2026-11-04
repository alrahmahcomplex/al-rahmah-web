import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { getLead, isClosed, listContactChildren, type Lead } from "@/lib/services/leads"
import { getReApplication, type ReApplication } from "@/lib/services/re-applications"
import type { StaffMember } from "@/lib/services/staff-auth"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/server"

import { closedState } from "../../leads/[id]/closed-state"
import { canRaiseReopening } from "../../leads/[id]/reopening-outcome"
import { requireStaff } from "../../session"
import { differingText, when } from "../format"
import { LeadBadges } from "../lead-badges"
import { ApplyField } from "./apply-field"
import { compareFields, reopeningHref } from "./compare"
import { MarkReviewed } from "./mark-reviewed"

export const metadata: Metadata = {
  title: "Re-application · Al-Rahmah Complex",
}

// One re-application: the lead it names, what the family sent beside what the
// lead holds, and whether anyone has reviewed it. Staff with leads.edit mark
// it reviewed here, on a closed lead too, since the review changes the
// re-application, not the lead. On an open lead they Apply what differs; a
// closed one offers Request reopening instead.
export default async function ReApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const { id } = await params
  const supabase = await createClient()
  const reApplication = await getReApplication(supabase, id)
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
  const closed = isClosed(entry)

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

      {closed && <ClosedLead entry={entry} staff={staff} />}

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

      <Comparison entry={entry} staff={staff} />
    </div>
  )
}

// A Declined, Inactive or Archived lead is read-only, so nothing the family
// sent can be applied until a Manager approves reopening it.
function ClosedLead({ entry, staff }: { entry: ReApplication; staff: StaffMember }) {
  const title = `This lead is ${closedState(entry)}`
  return (
    <section aria-label={title} className="flex max-w-xl flex-col gap-3 rounded-lg border bg-card p-4 text-sm">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <p className="text-muted-foreground">
        A closed lead is read-only, so what the family sent can&apos;t be applied. To work on it again, it has to be
        reopened, and a Manager approves that.
      </p>
      {canRaiseReopening(staff.permissions) && (
        <div>
          <Link href={reopeningHref(entry.leadId, entry.id)} className={buttonVariants({ size: "sm" })}>
            Request reopening
          </Link>
        </div>
      )}
    </section>
  )
}

// What the lead holds now beside what the family sent, field by field. The
// fields that differed on arrival are highlighted, as many as the queue
// counts; on an open lead staff with leads.edit Apply each one.
async function Comparison({ entry, staff }: { entry: ReApplication; staff: StaffMember }) {
  const supabase = await createClient()
  const lead = await getLead(supabase, entry.leadId)

  let body: React.ReactNode
  if (!lead.ok) {
    body = (
      <Alert variant="destructive" className="max-w-xl">
        <AlertDescription>The lead could not be loaded to compare. Try again in a moment.</AlertDescription>
      </Alert>
    )
  } else {
    const canApply = !isClosed(lead.data) && staff.permissions.includes("leads.edit")
    // The children a contact change would also reach. If they can't be
    // listed, a contact field can't be applied, so it is never applied
    // unwarned.
    const children = canApply ? await listContactChildren(supabase, lead.data.contact.id) : null
    body = (
      <ComparisonTable
        entry={entry}
        lead={lead.data}
        canApply={canApply}
        contactChildren={children?.ok ? children.data : null}
      />
    )
  }

  return (
    <section aria-labelledby="re-application-compare" className="flex flex-col gap-2">
      <h2 id="re-application-compare" className="text-sm font-semibold text-slate-900">
        Compared with the lead
      </h2>
      {body}
    </section>
  )
}

const CONTACT_FIELDS = new Set(["contact_name", "relationship", "relationship_description", "phone", "whatsapp"])

function ComparisonTable({
  entry,
  lead,
  canApply,
  contactChildren,
}: {
  entry: ReApplication
  lead: Lead
  canApply: boolean
  contactChildren: { id: string; admissionNumber: string }[] | null
}) {
  const rows = compareFields(lead, entry.submitted, entry.differingFields)
  const siblings = contactChildren?.filter((child) => child.id !== lead.id) ?? []
  const childIds = contactChildren?.map((child) => child.id) ?? []
  const contactApplies = canApply && rows.some((row) => CONTACT_FIELDS.has(row.field) && row.differed && !row.matchesNow)

  return (
    <div className="flex flex-col gap-2">
      {contactApplies && siblings.length > 0 && (
        <p className="max-w-xl text-sm text-muted-foreground">
          A parent or guardian change also reaches{" "}
          {siblings.map((child, index) => (
            <span key={child.id}>
              {index > 0 && ", "}
              <span className="font-mono">{child.admissionNumber}</span>
            </span>
          ))}
          , who {siblings.length === 1 ? "shares" : "share"} this contact.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        <table aria-label="Compared with the lead" className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Field</th>
              <th scope="col" className="px-3 py-2 font-medium">On the lead</th>
              <th scope="col" className="px-3 py-2 font-medium">Sent by the family</th>
              {canApply && (
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Apply</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const contactField = CONTACT_FIELDS.has(row.field)
              const applicable = row.differed && !row.matchesNow && (!contactField || contactChildren !== null)
              return (
                <tr
                  key={row.field}
                  className={cn("border-b align-top last:border-b-0", row.differed && "bg-amber-50")}
                >
                  <th scope="row" className="px-3 py-2 font-medium text-slate-900">
                    <span className="flex flex-wrap items-center gap-2">
                      {row.label}
                      {row.differed && (
                        <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-900">
                          Differs
                        </Badge>
                      )}
                    </span>
                  </th>
                  <td className="px-3 py-2 break-words text-slate-900">{row.stored}</td>
                  <td className={cn("px-3 py-2 break-words text-slate-900", row.differed && "font-semibold")}>
                    {row.sent}
                    {row.typedAs && <span className="block text-xs font-normal text-muted-foreground">Typed as {row.typedAs}</span>}
                  </td>
                  {canApply && (
                    <td className="px-3 py-2">
                      {row.differed && row.matchesNow && <span className="text-xs text-muted-foreground">Matches now</span>}
                      {applicable && (
                        <ApplyField
                          reApplicationId={entry.id}
                          field={row.field}
                          label={row.label}
                          contactChildren={contactField ? childIds : []}
                        />
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
