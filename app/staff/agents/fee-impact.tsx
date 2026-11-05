import { Alert, AlertDescription } from "@/components/ui/alert"
import type { FeeImpactFamily } from "@/lib/services/marketing-agents"

import { familyLine, feeImpactLine } from "./outcome"

export type ImpactState = { status: "loading" } | { status: "ready"; families: FeeImpactFamily[] } | { status: "refused"; message: string }

function tzs(amount: number) {
  return `TZS ${amount.toLocaleString("en-US")}`
}

// The fee-impact part of the status and Recreate dialogs: how many families'
// interview fee the change moves, the list, and a Swahili line to read to them.
export function FeeImpact({ impact }: { impact: ImpactState }) {
  const families = impact.status === "ready" ? impact.families : []
  return (
    <section aria-label="Fee impact" className="grid gap-2" aria-busy={impact.status === "loading"}>
      {impact.status === "loading" && <p className="text-sm text-muted-foreground">Finding the families this changes…</p>}
      {impact.status === "refused" && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{impact.message}</AlertDescription>
        </Alert>
      )}
      {impact.status === "ready" && (
        <>
          <p className="text-sm font-semibold text-slate-900">{feeImpactLine(families.length)}</p>
          {families.length > 0 && (
            <>
              <ul aria-label="Families not yet Paid" className="max-h-48 divide-y overflow-y-auto rounded-md text-sm ring-1 ring-foreground/10">
                {families.map((family) => (
                  <li key={family.leadId} className="px-3 py-2">
                    <p className="font-medium text-slate-900">
                      {family.studentName} <span className="font-normal text-muted-foreground">· {family.admissionNumber} · {family.className}</span>
                    </p>
                    <p className="text-muted-foreground">
                      {family.contactName} · <a href={`tel:${family.contactPhone}`} className="underline-offset-4 hover:underline">{family.contactPhone}</a>{" "}
                      · {tzs(family.feeNow)} → {tzs(family.feeAfter)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                <p className="text-xs text-muted-foreground">Read this to each family:</p>
                <p lang="sw" className="text-slate-900">
                  {familyLine(families[0])}
                </p>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
