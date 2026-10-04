import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/school-calendar"
import { BAND_NAMES } from "@/lib/services/fees"
import { getLeadFee } from "@/lib/services/lead-fees"
import { listPayments, PAYMENT_TYPE_NAMES } from "@/lib/services/school-fee-payments"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../../fees/format"
import { SeatPriorityBadge } from "../seat-priority-badge"
import { RecordPayment } from "./record-payment"

const INSTALMENTS = ["First", "Second", "Third"] as const

// The school is in Tanzania, so times read in East Africa Time whatever the
// server's own zone is.
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// The lead's School fee on the lead screen, for staff who may view payments:
// the annual fee for its class band and Day or boarding, Total paid, the
// balance, the Seat priority, the three instalments with their due dates,
// and the payments, newest first. It follows the Fee schedule of the lead's
// own enrollment year. Record payment shows only when `canRecord`: on an open
// lead, for staff who may record payments.
export async function SchoolFeeSection({ leadId, staff, canRecord }: { leadId: string; staff: StaffMember; canRecord: boolean }) {
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

          {canRecord && <RecordPayment leadId={leadId} />}
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
          <ul aria-label="Payments" className="flex flex-col divide-y rounded-lg text-sm ring-1 ring-foreground/10">
            {payments.data.map((payment) => (
              <li key={payment.id} className="flex items-start justify-between gap-4 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{PAYMENT_TYPE_NAMES[payment.type]}</p>
                  <p className="text-xs text-muted-foreground">
                    Paid {formatDate(payment.paidOn)}. Recorded by {payment.recordedBy ?? "a former staff member"},{" "}
                    {WHEN.format(new Date(payment.recordedAt))}.
                  </p>
                </div>
                <p className="shrink-0 text-right tabular-nums text-slate-900">
                  {payment.amount === null ? "Waived" : `TZS ${formatShillings(payment.amount)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  )
}
