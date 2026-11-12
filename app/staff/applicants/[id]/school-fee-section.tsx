import { Note } from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"
import { FEE_DISCOUNT_NAMES } from "@/lib/services/discounts"
import { BAND_NAMES } from "@/lib/services/fees"
import { getLeadFee } from "@/lib/services/lead-fees"
import { listPayments } from "@/lib/services/school-fee-payments"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../../fees/format"
import { enrolledBy } from "./enrolment-text"
import { InstalmentTable } from "./instalment-table"
import { PaymentList } from "./payment-list"
import { PreFormOneProgramme } from "./pre-form-one-programme"
import { PreFormOneTickSection } from "./pre-form-one-tick-section"
import { RecordPayment } from "./record-payment"
import { SeatPriorityTag } from "./seat-priority-tag"

const INSTALMENTS = ["First", "Second", "Third"] as const

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
// the tick applies.
export async function SchoolFeeSection({
  leadId,
  staff,
  canRecord,
  canAdjust,
  canEditPreFormOne = false,
  formOne = false,
}: {
  leadId: string
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
  const [fee, payments] = await Promise.all([getLeadFee(supabase, leadId), listPayments(supabase, leadId)])

  return (
    <section aria-labelledby="lead-school-fee" className="lr-card">
      <h2 id="lead-school-fee" className="kit-card-title">
        School fee
      </h2>
      {!fee.ok ? (
        <Note tone="bad">The School fee could not be loaded. Try again in a moment.</Note>
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

          {canRecord && (
            <RecordPayment
              leadId={leadId}
              canWaive={fee.data.discount?.kind === "qualified_orphan"}
              canPayPreFormOne={fee.data.preFormOne.applies}
            />
          )}
        </div>
      )}

      <section aria-labelledby="lead-payments" className="lr-part">
        <h3 id="lead-payments" className="lr-sub">
          Payments
        </h3>
        {!payments.ok ? (
          <Note tone="bad">The payments could not be loaded. Try again in a moment.</Note>
        ) : payments.data.length === 0 ? (
          <p className="lr-quiet">No payments recorded yet.</p>
        ) : (
          <PaymentList leadId={leadId} payments={payments.data} canAdjust={canAdjust} />
        )}
      </section>
    </section>
  )
}
