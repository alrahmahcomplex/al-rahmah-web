import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/school-calendar"
import { DISCOUNT_NAMES } from "@/lib/services/discounts"
import { BAND_NAMES } from "@/lib/services/fees"
import { getLeadFee } from "@/lib/services/lead-fees"
import { listPayments } from "@/lib/services/school-fee-payments"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../../fees/format"
import { SeatPriorityBadge } from "../seat-priority-badge"
import { enrolledBy } from "./enrolment-text"
import { PaymentList } from "./payment-list"
import { RecordPayment } from "./record-payment"

const INSTALMENTS = ["First", "Second", "Third"] as const

// The lead's School fee on the lead screen, for staff who may view payments:
// the annual fee for its class band and Day or boarding, Total paid, the
// balance, the Seat priority, the three instalments with their due dates,
// and the payments, newest first. It follows the Fee schedule of the lead's
// own enrollment year, less the discount it names. Record payment shows only
// when `canRecord`: on an open lead, for staff who may record payments, and
// offers Fee waived under a Qualified orphan discount. Adjust shows when
// `canAdjust`, on a closed lead too, since an adjustment corrects history.
export async function SchoolFeeSection({
  leadId,
  staff,
  canRecord,
  canAdjust,
}: {
  leadId: string
  staff: StaffMember
  canRecord: boolean
  canAdjust: boolean
}) {
  if (!staff.permissions.includes("payments.view")) return null

  const supabase = await createClient()
  const [fee, payments] = await Promise.all([getLeadFee(supabase, leadId), listPayments(supabase, leadId)])

  return (
    <section aria-labelledby="lead-school-fee" className="flex flex-col gap-2">
      <h2 id="lead-school-fee" className="text-sm font-semibold text-slate-900">
        School fee
      </h2>
      {!fee.ok ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription>The School fee could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : fee.data.kind === "no-schedule" ? (
        <p className="text-sm text-muted-foreground">No fee schedule for {fee.data.year} yet.</p>
      ) : (
        <div className="flex max-w-xl flex-col gap-4">
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">
              Annual fee
              <span className="block text-xs">
                {BAND_NAMES[fee.data.band]}, {fee.data.dayOrBoarding}
              </span>
              {fee.data.discount && (
                <span className="block text-xs">
                  {DISCOUNT_NAMES[fee.data.discount.kind]} discount, {fee.data.discount.percent}% off TZS{" "}
                  {formatShillings(fee.data.bandFee)}
                </span>
              )}
            </dt>
            <dd className="text-right font-medium tabular-nums text-slate-900">TZS {formatShillings(fee.data.schoolFee)}</dd>
            <dt className="text-muted-foreground">Total paid</dt>
            <dd className="text-right tabular-nums text-slate-900">TZS {formatShillings(fee.data.totalPaid)}</dd>
            <dt className="text-muted-foreground">Balance</dt>
            <dd className="text-right font-medium tabular-nums text-slate-900">TZS {formatShillings(fee.data.balance)}</dd>
            <dt className="text-muted-foreground">
              Seat priority
              {fee.data.priorityReachedOn && <span className="block text-xs">Since {formatDate(fee.data.priorityReachedOn)}</span>}
            </dt>
            <dd className="text-right text-slate-900">
              {fee.data.priority ? <SeatPriorityBadge priority={fee.data.priority} /> : <span className="text-muted-foreground">None yet</span>}
            </dd>
            {fee.data.enrolment && (
              <>
                <dt className="text-muted-foreground">
                  Enrolled
                  <span className="block text-xs">On {formatDate(fee.data.enrolment.on)}</span>
                </dt>
                <dd className="text-right text-slate-900">{enrolledBy(fee.data.enrolment)}</dd>
              </>
            )}
          </dl>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Instalment</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead className="text-right">Amount (TZS)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fee.data.instalments.map((instalment, index) => (
                <TableRow key={INSTALMENTS[index]}>
                  <TableCell>{INSTALMENTS[index]}</TableCell>
                  <TableCell className="text-right">{formatDate(instalment.due)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatShillings(instalment.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {canRecord && <RecordPayment leadId={leadId} canWaive={fee.data.discount?.kind === "qualified_orphan"} />}
        </div>
      )}

      <section aria-labelledby="lead-payments" className="flex max-w-xl flex-col gap-2 pt-2">
        <h3 id="lead-payments" className="text-sm font-medium text-slate-900">
          Payments
        </h3>
        {!payments.ok ? (
          <Alert variant="destructive">
            <AlertDescription>The payments could not be loaded. Try again in a moment.</AlertDescription>
          </Alert>
        ) : payments.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <PaymentList leadId={leadId} payments={payments.data} canAdjust={canAdjust} />
        )}
      </section>
    </section>
  )
}
