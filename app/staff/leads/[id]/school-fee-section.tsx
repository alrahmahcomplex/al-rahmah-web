import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/school-calendar"
import { BAND_NAMES } from "@/lib/services/fees"
import { getLeadFee } from "@/lib/services/lead-fees"
import type { StaffMember } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { formatShillings } from "../../fees/format"

const INSTALMENTS = ["First", "Second", "Third"] as const

// The lead's School fee on the lead screen, for staff who may view payments:
// the annual fee for its class band and Day or boarding, Total paid, the
// balance, and the three instalments with their due dates. It follows the
// Fee schedule of the lead's own enrollment year.
export async function SchoolFeeSection({ leadId, staff }: { leadId: string; staff: StaffMember }) {
  if (!staff.permissions.includes("payments.view")) return null

  const fee = await getLeadFee(await createClient(), leadId)

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
        </div>
      )}
    </section>
  )
}
