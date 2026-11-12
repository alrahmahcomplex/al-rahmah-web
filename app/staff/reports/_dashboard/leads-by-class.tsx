"use client"

import { Table } from "@/components/kit"
import type { LeadsByClass } from "@/lib/services/dashboard"

// The Leads by enrollment class table: every class in school order, zeros
// included, and the panel total.
export function LeadsByClassTable({ counts }: { counts: LeadsByClass }) {
  return (
    <>
      <Table
        label="Applicants in each class"
        rows={counts.classes}
        rowKey={(row) => row.className}
        columns={[
          { header: "Class", cell: (row) => row.className },
          {
            header: "Applicants",
            align: "end",
            cell: (row) => (
              <span className={row.count === 0 ? "rp-quiet" : undefined} data-testid={`classes-count-${row.className}`}>
                {row.count.toLocaleString("en-GB")}
              </span>
            ),
          },
        ]}
        total={["Total", <span key="total" data-testid="classes-total">{counts.total.toLocaleString("en-GB")}</span>]}
      />
      <p className="rp-cap">Counted by the date the application was created</p>
    </>
  )
}
