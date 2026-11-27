"use client"

import Link from "next/link"

import { Table, Tag } from "@/components/kit"
import type { InterviewFeeStatus, InterviewResult } from "@/lib/services/interviews"

import "./interviews.css"
import { ResultTag } from "./result-tag"

export type InterviewTableRow = {
  id: string
  serialNumber: number
  admissionNumber: string
  studentName: string
  leadHref: string
  // A closed lead stays on the list, marked with how it closed.
  closed: { text: string; declined: boolean } | null
  className: string
  dayOrBoarding: string
  result: InterviewResult | null
  score: number | null
  feeStatus: InterviewFeeStatus
  sentOn: string | null
}

/**
 * One page of interviews in S/N order. The student's name opens the lead on
 * its Interview tab. The fee and sent cells carry data-column, so a test can
 * read a column without counting cells.
 */
export function InterviewsTable({ label, rows }: { label: string; rows: InterviewTableRow[] }) {
  return (
    <Table
      label={label}
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        { header: "S/N", cell: (row) => <span className="iv-sn">{row.serialNumber}</span> },
        { header: "Admission Number", cell: (row) => <span className="iv-nowrap">{row.admissionNumber}</span> },
        {
          header: "Student",
          rowHeader: true,
          cell: (row) => (
            <span className="iv-student">
              <Link href={row.leadHref} className="iv-name" data-closed={row.closed ? "" : undefined}>
                {row.studentName}
              </Link>
              {row.closed && <Tag tone={row.closed.declined ? "bad" : "line"}>{row.closed.text}</Tag>}
            </span>
          ),
        },
        { header: "Class", cell: (row) => <span className="iv-nowrap">{row.className}</span> },
        { header: "Day or boarding", cell: (row) => row.dayOrBoarding },
        {
          header: "Result",
          cell: (row) =>
            row.result === null ? (
              <span className="iv-quiet iv-nowrap">No result yet</span>
            ) : (
              <ResultTag result={row.result} />
            ),
        },
        {
          header: "Score",
          align: "end",
          cell: (row) => (row.score === null ? <span className="iv-quiet">–</span> : `${row.score}%`),
        },
        {
          header: "Interview fee",
          cell: (row) => (
            <span data-column="fee">
              <Tag tone={row.feeStatus === "Paid" ? "ok" : "wait"}>{row.feeStatus}</Tag>
            </span>
          ),
        },
        {
          header: "Result sent",
          cell: (row) => (
            <span data-column="sent" className="iv-nowrap">
              {row.sentOn}
            </span>
          ),
        },
      ]}
    />
  )
}
