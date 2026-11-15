"use client"

import Link from "next/link"

import { Table } from "@/components/kit"
import type { LeadClosure, LeadStatus } from "@/lib/services/leads"

import { LeadBadges } from "./lead-badges"
import "./re-applications.css"

// A re-application as its row shows it. The times are written on the server,
// so the browser's own date words never differ from them.
export type ReApplicationRow = {
  id: string
  admissionNumber: string
  studentName: string
  status: LeadStatus
  closure: LeadClosure | null
  receivedAt: string
  receivedOn: string
  differences: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewedOn: string | null
}

/** One page of re-applications. The Admission Number opens the re-application. */
export function ReApplicationsTable({ rows, reviewed }: { rows: ReApplicationRow[]; reviewed: boolean }) {
  return (
    <Table
      label="Re-applications"
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        {
          header: "Admission Number",
          rowHeader: true,
          cell: (row) => (
            <Link href={`/staff/re-applications/${row.id}`} className="ra-number">
              {row.admissionNumber}
            </Link>
          ),
        },
        { header: "Student", cell: (row) => <span className="ra-name">{row.studentName}</span> },
        { header: "Application", cell: (row) => <LeadBadges status={row.status} closure={row.closure} /> },
        {
          header: "Arrived",
          cell: (row) => (
            <time dateTime={row.receivedAt} className="ra-nowrap">
              {row.receivedOn}
            </time>
          ),
        },
        { header: "Differences", cell: (row) => <span className="ra-nowrap">{row.differences}</span> },
        ...(reviewed
          ? [
              {
                header: "Reviewed",
                cell: (row: ReApplicationRow) => (
                  <>
                    <b>{row.reviewedBy ?? "Unknown"}</b>
                    {row.reviewedAt && (
                      <small className="ra-nowrap">
                        <time dateTime={row.reviewedAt}>{row.reviewedOn}</time>
                      </small>
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
