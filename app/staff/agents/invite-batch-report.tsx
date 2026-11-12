import Link from "next/link"

import { Card } from "@/components/kit"
import type { BatchOutcome, InviteBatchReport } from "@/lib/services/agent-invite-batches"

import { batchHeading, batchStopLine, skippedLine } from "./invite-batch-outcome"
import { agentsHref, type AgentScreenSearch } from "./search-params"
import "./agents.css"

const COUNTS: { outcome: BatchOutcome; label: string; count: (report: InviteBatchReport) => number }[] = [
  { outcome: "sent", label: "sent", count: (report) => report.counts.sent },
  { outcome: "waiting", label: "waiting", count: (report) => report.counts.waiting },
  { outcome: "no_email", label: "no email", count: (report) => report.counts.noEmail },
  { outcome: "failed", label: "failed", count: (report) => report.counts.failed },
]

// An invite batch's report (#192): "sent X, waiting Y, no email Z, failed W",
// each count linking to its agents, read from the database on every load.
export function InviteBatchReportPanel({ report, search }: { report: InviteBatchReport; search: AgentScreenSearch }) {
  const skipped = skippedLine(report)
  return (
    <Card title="Invite batch" caption={batchHeading(report)}>
      <div className="ag-card-body">
        <p className="ag-p">
          {COUNTS.map(({ outcome, label, count }, i) => {
            const current = search.batchId === report.id && search.batchOutcome === outcome
            return (
              <span key={outcome}>
                {i > 0 && ", "}
                <Link
                  href={agentsHref(search, { batchId: report.id, batchOutcome: outcome, query: undefined, page: 1 })}
                  aria-current={current ? "page" : undefined}
                  className="ag-link"
                >
                  {label} <span className="tabular-nums">{count(report)}</span>
                </Link>
              </span>
            )
          })}
        </p>
        <p className="ag-p">{batchStopLine(report)}</p>
        {skipped && <p className="ag-p ag-quiet">{skipped}</p>}
      </div>
    </Card>
  )
}
