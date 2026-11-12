import { Note } from "@/components/kit"
import type { FeeImpactFamily } from "@/lib/services/marketing-agents"

import { familyLine, feeImpactLine } from "./outcome"
import "./agents.css"

export type ImpactState = { status: "loading" } | { status: "ready"; families: FeeImpactFamily[] } | { status: "refused"; message: string }

function tzs(amount: number) {
  return `TZS ${amount.toLocaleString("en-US")}`
}

// The fee-impact part of the status and Recreate dialogs: how many families'
// interview fee the change moves, the list, and a Swahili line to read to them.
export function FeeImpact({ impact }: { impact: ImpactState }) {
  const families = impact.status === "ready" ? impact.families : []
  return (
    <section aria-label="Fee impact" className="ag-stack" aria-busy={impact.status === "loading"}>
      {impact.status === "loading" && <p className="ag-p ag-quiet">Finding the families this changes…</p>}
      {impact.status === "refused" && (
        <Note tone="bad" role="alert">
          {impact.message}
        </Note>
      )}
      {impact.status === "ready" && (
        <>
          <p className="ag-p ag-strong">{feeImpactLine(families.length)}</p>
          {families.length > 0 && (
            <>
              <ul aria-label="Families not yet Paid" className="ag-families">
                {families.map((family) => (
                  <li key={family.leadId}>
                    <span className="ag-strong">{family.studentName}</span>{" "}
                    <span className="ag-quiet">
                      · {family.admissionNumber} · {family.className}
                    </span>
                    <small>
                      {family.contactName} ·{" "}
                      <a href={`tel:${family.contactPhone}`} className="ag-tel">
                        {family.contactPhone}
                      </a>{" "}
                      · {tzs(family.feeNow)} → {tzs(family.feeAfter)}
                    </small>
                  </li>
                ))}
              </ul>
              <div className="ag-read">
                <p className="ag-small ag-quiet">Read this to each family:</p>
                <p lang="sw">{familyLine(families[0])}</p>
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
