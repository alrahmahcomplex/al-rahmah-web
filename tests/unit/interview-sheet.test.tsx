import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { BoardRow } from "@/app/staff/interviews/board"
import type { SheetDetails } from "@/app/staff/interviews/sheet-actions"

// The Interviews side sheet reads the interview when it opens and again each
// time the list's rows come back from the server, as they do after a save in
// the sheet, even when the save changed nothing the row shows (review of #563:
// a date-only correction).

const load = vi.hoisted(() => vi.fn())
vi.mock("@/app/staff/interviews/sheet-actions", () => ({ loadInterviewSheet: load }))
// The record's own editors call Server Actions; here they only show what they were given.
vi.mock("@/app/staff/applicants/[id]/interview-result", () => ({
  InterviewResultEditor: ({ interview }: { interview: { interviewDate: string | null } }) => <p>Editor starts at {interview.interviewDate}</p>,
}))
vi.mock("@/app/staff/applicants/[id]/interview-fee", () => ({ InterviewFeeControl: () => null }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const { InterviewSheet } = await import("@/app/staff/interviews/interview-sheet")

const ROW: BoardRow = {
  id: "00000000-0000-4000-8000-000000000001",
  leadId: "00000000-0000-4000-9000-000000000001",
  serialNumber: 7,
  admissionNumber: "ADMSN-00142",
  studentName: "Amina Juma Mrisho",
  className: "KG 2",
  dayOrBoarding: "Day",
  registeredOn: "2026-11-01",
  result: "Passed",
  score: 77,
  feeStatus: "Paid",
  sentOn: null,
  closed: null,
}

function details(interviewDate: string): { ok: true; details: SheetDetails } {
  return {
    ok: true,
    details: {
      interview: {
        id: ROW.id,
        serialNumber: 7,
        enrollmentYear: 2027,
        registeredOn: "2026-11-01",
        interviewDate,
        result: "Passed",
        score: 77,
        nextAction: "Complete enrollment",
        feeStatus: "Paid",
        amount: 50000,
        discountApplied: false,
        agreementSignedOn: null,
        agreementSignedBy: null,
      },
      current: true,
      release: { text: "Ready to send.", sent: false },
      others: [],
    },
  }
}

const sheet = (row: BoardRow) => <InterviewSheet row={row} canRecord canMarkFee={false} fullRecordHref={() => "/staff/applicants/x"} onClose={() => {}} />

describe("the Interviews side sheet", () => {
  it("reads the interview again when the rows come back from the server, even if the row looks the same", async () => {
    load.mockResolvedValueOnce(details("2026-11-23")).mockResolvedValueOnce(details("2026-11-24"))
    const { rerender } = render(sheet(ROW))
    expect(await screen.findByText("Editor starts at 2026-11-23")).toBeInTheDocument()
    expect(screen.getByText("23 Nov 2026")).toBeInTheDocument()

    // A date-only correction: the list refreshes with a row that shows the same values.
    rerender(sheet({ ...ROW }))
    expect(await screen.findByText("Editor starts at 2026-11-24")).toBeInTheDocument()
    expect(screen.getByText("24 Nov 2026")).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith(ROW.leadId, ROW.id)
  })

  it("does not read again while the rows are unchanged", async () => {
    load.mockReset()
    load.mockResolvedValue(details("2026-11-23"))
    const { rerender } = render(sheet(ROW))
    await screen.findByText("Editor starts at 2026-11-23")
    rerender(sheet(ROW))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  })
})
