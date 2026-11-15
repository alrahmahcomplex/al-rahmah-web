"use client"

import { Table, Tag } from "@/components/kit"

import "../re-applications.css"
import { ApplyField } from "./apply-field"
import type { ComparedField } from "./compare"

// One compared field as its row shows it, with what the server worked out:
// whether Apply is offered, and why a Discount code is not.
export type ComparisonRow = ComparedField & {
  applicable: boolean
  // Why a Discount code the family sent offers no Apply; null otherwise.
  codeNote: string | null
  // The children a contact change also reaches; empty for other fields.
  contactChildren: string[]
}

/**
 * What the lead holds now beside what the family sent, field by field. A
 * field that differed on arrival is tagged Differs and its sent value is
 * bold; on an open lead staff with leads.edit Apply each one.
 */
export function ComparisonTable({ reApplicationId, rows, canApply }: { reApplicationId: string; rows: ComparisonRow[]; canApply: boolean }) {
  return (
    <Table
      label="Compared with the application"
      rows={rows}
      rowKey={(row) => row.field}
      columns={[
        {
          header: "Field",
          rowHeader: true,
          cell: (row) => (
            <span className="ra-field">
              {row.label}
              {row.differed && <Tag tone="wait">Differs</Tag>}
            </span>
          ),
        },
        { header: "On the application", cell: (row) => <span className="ra-value">{row.stored}</span> },
        {
          header: "Sent by the family",
          cell: (row) => (
            <span className="ra-value" data-differed={row.differed ? "" : undefined}>
              {row.sent}
              {row.typedAs && <small className="ra-sub">Typed as {row.typedAs}</small>}
              {row.codeNote && <small className="ra-sub">{row.codeNote}</small>}
            </span>
          ),
        },
        ...(canApply
          ? [
              {
                header: <span className="sr-only">Apply</span>,
                cell: (row: ComparisonRow) => (
                  <>
                    {row.differed && row.matchesNow && <small className="ra-sub">Matches now</small>}
                    {row.applicable && (
                      <ApplyField reApplicationId={reApplicationId} field={row.field} label={row.label} contactChildren={row.contactChildren} />
                    )}
                  </>
                ),
              },
            ]
          : []),
      ]}
    />
  )
}
