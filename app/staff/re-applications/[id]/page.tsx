import type { Metadata } from "next"
import Link from "next/link"

import { ButtonLink, Card, Note, PageHeader, pageTitle } from "@/components/kit"
import { getLead, isClosed, listContactChildren, type Lead } from "@/lib/services/leads"
import { getReApplication, type ReApplication } from "@/lib/services/re-applications"
import { findReferralAgent } from "@/lib/services/referral"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { closedState } from "../../applicants/[id]/closed-state"
import { canRaiseReopening } from "../../applicants/[id]/reopening-outcome"
import StaffForbidden from "../../forbidden"
import StaffNotFound from "../../not-found"
import { requireStaff } from "../../session"
import { differingText, when } from "../format"
import { LeadBadges } from "../lead-badges"
import "../re-applications.css"
import { compareFields, reopeningHref } from "./compare"
import { ComparisonTable, type ComparisonRow } from "./comparison-table"
import { MarkReviewed } from "./mark-reviewed"

export const metadata: Metadata = {
  title: pageTitle("Re-application"),
}

// One re-application: the lead it names, what the family sent beside what the
// lead holds, and whether anyone has reviewed it. Staff with leads.edit mark
// it reviewed here, on a closed lead too, since the review changes the
// re-application, not the lead. On an open lead they Apply what differs; a
// closed one offers Request reopening instead. Drawn in the new shell (#328).
export default async function ReApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) return <StaffForbidden />

  const { id } = await params
  const supabase = await createClient()
  const reApplication = await getReApplication(supabase, id)
  if (!reApplication.ok && reApplication.error === "not-found") return <StaffNotFound />
  if (!reApplication.ok) {
    return (
      <>
        <BackLink />
        <PageHeader title="Re-application" />
        <Note tone="bad" role="alert">
          This re-application could not be loaded. Try again in a moment.
        </Note>
      </>
    )
  }

  const entry = reApplication.data
  const canReview = entry.reviewedAt === null && staff.permissions.includes("leads.edit")
  const closed = isClosed(entry)

  return (
    <>
      <BackLink />
      <PageHeader
        title="Re-application"
        subtitle={
          <>
            <span className="ra-who">
              <Link href={`/staff/applicants/${entry.leadId}`} className="ra-number">
                {entry.admissionNumber}
              </Link>
              <span className="ra-name">{entry.studentName}</span>
              <LeadBadges status={entry.status} closure={entry.closure} />
            </span>
            <span className="ra-arrived">
              Arrived <time dateTime={entry.receivedAt}>{when(entry.receivedAt)}</time> from the Admission form.{" "}
              {differingText(entry.differingFields.length)} from the application.
            </span>
          </>
        }
      />

      <div className="ra-stack">
        {closed && <ClosedLead entry={entry} staff={staff} quiet={canReview} />}

        <Card title="Review" titleId="re-application-review">
          {entry.reviewedAt ? (
            <p className="ra-text">
              Reviewed by {entry.reviewedBy ?? "Unknown"} on <time dateTime={entry.reviewedAt}>{when(entry.reviewedAt)}</time>
            </p>
          ) : (
            <p className="ra-text">Not reviewed yet.</p>
          )}
          {canReview && <MarkReviewed reApplicationId={entry.id} />}
        </Card>

        <Comparison entry={entry} staff={staff} />
      </div>
    </>
  )
}

function BackLink() {
  return (
    <Link href="/staff/re-applications" className="kit-link ra-back">
      Re-applications
    </Link>
  )
}

// A Declined, Inactive or Archived lead is read-only, so nothing the family
// sent can be applied until a Manager approves reopening it. Request
// reopening is the screen's next step unless Mark reviewed is there too
// (`quiet`), which keeps the one orange button (The One Invitation Rule).
function ClosedLead({ entry, staff, quiet }: { entry: ReApplication; staff: StaffMember; quiet: boolean }) {
  const title = `This application is ${closedState(entry)}`
  return (
    <Card title={title}>
      <p className="ra-text">
        A closed application is read-only, so what the family sent can&apos;t be applied. To work on it again, it has to be
        reopened, and a Manager approves that.
      </p>
      {canRaiseReopening(staff.permissions) && (
        <div className="ra-act">
          <ButtonLink href={reopeningHref(entry.leadId, entry.id)} size="small" variant={quiet ? "ghost" : undefined}>
            Request reopening
          </ButtonLink>
        </div>
      )}
    </Card>
  )
}

// Whether a Marketing Agent holds the Discount code the family sent: only
// then can Apply make it the lead's Referral code. Null when no code was sent
// or the check failed, which offers no Apply either.
type SentCode = { recognised: boolean } | null

const CONTACT_FIELDS = new Set(["contact_name", "relationship", "relationship_description", "phone", "whatsapp"])

// What the lead holds now beside what the family sent, field by field. The
// fields that differed on arrival are tagged, as many as the queue counts; on
// an open lead staff with leads.edit Apply each one.
async function Comparison({ entry, staff }: { entry: ReApplication; staff: StaffMember }) {
  const supabase = await createClient()
  const sentCode = entry.submitted.discountCode
  const [lead, agent] = await Promise.all([
    getLead(supabase, entry.leadId),
    sentCode ? findReferralAgent(supabase, sentCode) : null,
  ])
  const codeCheck: SentCode = agent?.ok ? { recognised: agent.data !== null } : null

  let body: React.ReactNode
  if (!lead.ok) {
    body = (
      <Note tone="bad" role="alert">
        The application could not be loaded to compare. Try again in a moment.
      </Note>
    )
  } else {
    const canApply = !isClosed(lead.data) && staff.permissions.includes("leads.edit")
    // The children a contact change would also reach. If they can't be
    // listed, a contact field can't be applied, so it is never applied
    // unwarned.
    const children = canApply ? await listContactChildren(supabase, lead.data.contact.id) : null
    body = (
      <ComparisonBody
        entry={entry}
        lead={lead.data}
        sentCode={codeCheck}
        canApply={canApply}
        contactChildren={children?.ok ? children.data : null}
      />
    )
  }

  // The heading is plain, not the card's title: the table's own scroll area
  // is already a region with this name, and two would repeat the landmark.
  return (
    <Card>
      <h2 id="re-application-compare" className="kit-card-title">
        Compared with the application
      </h2>
      {body}
    </Card>
  )
}

function ComparisonBody({
  entry,
  lead,
  sentCode,
  canApply,
  contactChildren,
}: {
  entry: ReApplication
  lead: Lead
  sentCode: SentCode
  canApply: boolean
  contactChildren: { id: string; admissionNumber: string }[] | null
}) {
  const compared = compareFields(lead, entry.submitted, entry.differingFields, entry.leadReferralCode)
  const siblings = contactChildren?.filter((child) => child.id !== lead.id) ?? []
  const childIds = contactChildren?.map((child) => child.id) ?? []
  const contactApplies = canApply && compared.some((row) => CONTACT_FIELDS.has(row.field) && row.differed && !row.matchesNow)

  const rows: ComparisonRow[] = compared.map((row) => {
    const contactField = CONTACT_FIELDS.has(row.field)
    const codeField = row.field === "discount_code"
    return {
      ...row,
      applicable:
        row.differed &&
        !row.matchesNow &&
        (!contactField || contactChildren !== null) &&
        (!codeField || sentCode?.recognised === true),
      codeNote: codeField && row.differed && !row.matchesNow ? codeNote(sentCode) : null,
      contactChildren: contactField ? childIds : [],
    }
  })

  return (
    <div className="ra-compare">
      {contactApplies && siblings.length > 0 && (
        <p className="ra-text ra-quiet">
          A parent or guardian change also reaches{" "}
          {siblings.map((child, index) => (
            <span key={child.id}>
              {index > 0 && ", "}
              <span className="ra-mono">{child.admissionNumber}</span>
            </span>
          ))}
          , who {siblings.length === 1 ? "shares" : "share"} this contact.
        </p>
      )}
      <ComparisonTable reApplicationId={entry.id} rows={rows} canApply={canApply} />
    </div>
  )
}

// Why a Discount code the family sent offers no Apply.
function codeNote(sentCode: SentCode): string | null {
  if (sentCode?.recognised) return null
  return sentCode
    ? "No Marketing Agent has this code, so it can't be applied."
    : "Whether an agent has this code could not be checked. Reload the page to try again."
}
