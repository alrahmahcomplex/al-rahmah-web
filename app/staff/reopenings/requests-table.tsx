"use client"

import Link from "next/link"

import { StatusChip, Table } from "@/components/kit"
import type { LeadClosure, LeadStatus } from "@/lib/services/leads"

import "./reopenings.css"

export type RequestRow = {
  id: string
  leadId: string
  admissionNumber: string
  studentName: string
  status: LeadStatus
  closure: LeadClosure | null
  requestedBy: string
  requestedAt: string
  requestedOn: string
  source: string
  reason: string
}

/** The Pending requests, as the prototype's Reopening requests table shows them. The Admission Number opens the application. */
export function RequestsTable({ rows }: { rows: RequestRow[] }) {
  return (
    <Table
      label="Pending reopening requests"
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        {
          header: "Student",
          cell: (row) => (
            <>
              <b>{row.studentName}</b>
              <Link href={`/staff/applicants/${row.leadId}`} className="rq-number">
                {row.admissionNumber}
              </Link>
            </>
          ),
        },
        {
          header: "Asked by",
          cell: (row) => (
            <>
              <b>{row.requestedBy}</b>
              <small>
                <time dateTime={row.requestedAt}>{row.requestedOn}</time> · {row.source}
              </small>
            </>
          ),
        },
        { header: "Why the family is back", cell: (row) => <span className="rq-reason">{row.reason}</span> },
        {
          header: "Status",
          cell: (row) => (
            <span className="rq-chips">
              <StatusChip status={row.status} />
              {row.closure && <StatusChip status={row.closure} />}
            </span>
          ),
        },
      ]}
    />
  )
}
