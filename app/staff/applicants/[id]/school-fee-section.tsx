import { Note } from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"
import { FEE_DISCOUNT_NAMES } from "@/lib/services/discounts"
import { BAND_NAMES } from "@/lib/services/fees"
import { getLeadFee } from "@/lib/services/lead-fees"
import type { Lead } from "@/lib/services/leads"
import { listPayments } from "@/lib/services/school-fee-payments"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../../fees/format"
import { enrolledBy } from "./enrolment-text"
import { FeeEditNeededTag, SiblingFeeControls } from "./fee-edit"
import { setByHandLine } from "./fee-edit-outcome"
import { InstalmentTable } from "./instalment-table"
import { PaymentList } from "./payment-list"
import { PreFormOneProgramme } from "./pre-form-one-programme"
import { PreFormOneTickSection } from "./pre-form-one-tick-section"
import { readSiblingView } from "./lead-reads"
import { readSeatCard } from "./seat-card"
import { SeatPriorityTag } from "./seat-priority-tag"

const INSTALMENTS = ["First", "Second", "Third"] as const

// When the Sibling group can't be read: Record payment alone.
const NO_SIBLING_FEE = { canEdit: false, feeEditNeeded: false, canKeep: false, setByHand: null, paymentNote: null }

// The lead's School fee on the lead screen, for staff who may view payments:
// the annual fee for its class band and Day or boarding, Total paid, the
// balance, the Seat priority, the three instalments with their due dates,
// and the payments, newest first. It follows the Fee schedule of the lead's
// own enrollment year, less the discount it names. Record payment shows only
// when `canRecord`: on an open lead, for staff who may record payments, and
// offers Fee waived under a Qualified orphan discount. Adjust shows when
// `canAdjust`, on a closed lead too, since an adjustment corrects history.
// The Pre-Form One programme (#114) shows apart from the School fee, its tick
// editable when `canEditPreFormOne`, and Record payment offers its fee while
// the tick applies. The Sibling fee edit and "Leave the fee as it is" (#311)
// sit beside Record payment for staff who may record payments; while a
// Sibling request waits, the payment form says the fee is recorded in full
// for now.
export async function SchoolFeeSection({
  leadId,
  lead,
  staff,
  canRecord,
  canAdjust,
  canEditPreFormOne = false,
  formOne = false,
}: {
  leadId: string
  // An open lead, for its seat note once streams are on (#449): every staff
  // member who sees the School fee sees it; the request and Open a new stream
  // buttons go by permission.
  lead?: Lead
  staff: StaffMember
  canRecord: boolean
  canAdjust: boolean
  canEditPreFormOne?: boolean
  // The lead's class is FORM 1.
  formOne?: boolean
}) {
  // Without payments.view, only the Pre-Form One tick shows, for staff who
  // may still edit leads.
  if (!staff.permissions.includes("payments.view")) {
    return <PreFormOneTickSection leadId={leadId} formOne={formOne} canEdit={canEditPreFormOne} />
  }

  const supabase = await createClient()
  const [fee, payments, sibling, seat] = await Promise.all([
    getLeadFee(supabase, leadId),
    listPayments(supabase, leadId),
    readSiblingView(leadId, staff.permissions.join(",")),
    lead ? readSeatCard(supabase, lead, staff) : null,
  ])
  const siblingFee = sibling?.fee ?? null
  const byHand = siblingFee && setByHandLine(siblingFee)

  return (
    <section aria-labelledby="lead-school-fee" className="lr-card">
      <h2 id="lead-school-fee" className="kit-card-title">
        School fee
      </h2>
      {siblingFee && <FeeEditNeededTag fee={siblingFee} />}
      {!fee.ok ? (
        <Note tone="bad" role="alert">The School fee could not be loaded. Try again in a moment.</Note>
      ) : fee.data.kind === "no-schedule" ? (
        <div className="lr-form">
          <p className="lr-quiet">No fee schedule for {fee.data.year} yet.</p>
          <PreFormOneProgramme leadId={leadId} programme={fee.data.preFormOne} dayOrBoarding={null} canEdit={canEditPreFormOne} />
        </div>
      ) : (
        <div className="lr-form">
          <dl className="kit-kv">
            <dt>
              Annual fee
              <small>
                {BAND_NAMES[fee.data.band]}, {fee.data.dayOrBoarding}
              </small>
              {fee.data.discount && (
                <small>
                  {FEE_DISCOUNT_NAMES[fee.data.discount.kind]} discount, {fee.data.discount.percent}% off TZS{" "}
                  {formatShillings(fee.data.bandFee)}
                </small>
              )}
              {byHand && <small>{byHand.charAt(0).toUpperCase() + byHand.slice(1)}</small>}
            </dt>
            <dd className="kit-num">TZS {formatShillings(fee.data.schoolFee)}</dd>
            <dt>Total paid</dt>
            <dd className="kit-num">TZS {formatShillings(fee.data.totalPaid)}</dd>
            <dt>Balance</dt>
            <dd className="kit-num">TZS {formatShillings(fee.data.balance)}</dd>
            <dt>
              Seat priority
              {fee.data.priorityReachedOn && <small>Since {formatDate(fee.data.priorityReachedOn)}</small>}
            </dt>
            <dd>
              {fee.data.priority ? <SeatPriorityTag priority={fee.data.priority} /> : <span className="lr-quiet">None yet</span>}
            </dd>
            {fee.data.enrolment && (
              <>
                <dt>
                  Enrolled
                  <small>On {formatDate(fee.data.enrolment.on)}</small>
                </dt>
                <dd>{enrolledBy(fee.data.enrolment)}</dd>
              </>
            )}
          </dl>

          <InstalmentTable
            rows={fee.data.instalments.map((instalment, index) => ({
              name: INSTALMENTS[index],
              due: formatDate(instalment.due),
              amount: formatShillings(instalment.amount),
            }))}
          />

          <PreFormOneProgramme
            leadId={leadId}
            programme={fee.data.preFormOne}
            dayOrBoarding={fee.data.dayOrBoarding}
            canEdit={canEditPreFormOne}
          />

          {seat?.card}
          {canRecord ? (
            <SiblingFeeControls
              leadId={leadId}
              fee={siblingFee ?? NO_SIBLING_FEE}
              // While no stream can take the child, only a Pre-Form One fee can be recorded (#449).
              record={
                seat?.outlook.blocked && !fee.data.preFormOne.applies
                  ? null
                  : { canWaive: fee.data.discount?.kind === "qualified_orphan", canPayPreFormOne: fee.data.preFormOne.applies }
              }
            />
          ) : (
            siblingFee?.canKeep && <SiblingFeeControls leadId={leadId} fee={{ ...siblingFee, canEdit: false }} />
          )}
        </div>
      )}

      <section aria-labelledby="lead-payments" className="lr-part">
        <h3 id="lead-payments" className="lr-sub">
          Payments
        </h3>
        {!payments.ok ? (
          <Note tone="bad" role="alert">The payments could not be loaded. Try again in a moment.</Note>
        ) : payments.data.length === 0 ? (
          <p className="lr-quiet">No payments recorded yet.</p>
        ) : (
          <PaymentList leadId={leadId} payments={payments.data} canAdjust={canAdjust} />
        )}
      </section>
    </section>
  )
}
