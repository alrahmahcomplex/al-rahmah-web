import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { interviewRows } from "@/app/staff/interviews/rows"
import type { InterviewListItem } from "@/lib/services/interview-list"
import { listReleaseStatus } from "@/lib/services/result-release"

// The Interviews screen reads the list, then the release status. Another
// staff member can correct a result and send it between the two reads; each
// row must then show the result, score and sent date of one moment.

function listed(score: number): InterviewListItem {
  return {
    id: "interview-1",
    serialNumber: 1,
    lead: {
      id: "lead-1",
      admissionNumber: "ADMSN-00601",
      studentName: "Candidate One",
      className: "FORM 1",
      dayOrBoarding: "Day",
      status: "Interviewed",
      closure: null,
      closed: false,
    },
    result: "Passed",
    score,
    feeStatus: "Paid",
  }
}

function client(rows: object[]) {
  return { rpc: async () => ({ data: rows, error: null }) } as unknown as SupabaseClient
}

function statusRow(overrides: object) {
  return {
    interview_id: "interview-1",
    is_current: true,
    result: "Passed",
    score: 78,
    last_released_at: null,
    changed_since_sent: false,
    ready_to_send: true,
    ...overrides,
  }
}

describe("the Interviews screen's rows", () => {
  it("show the result and score the release status was read with, beside its sent date", async () => {
    // The list read 78. Before the status was read, 78 was corrected to 90
    // and 90 sent on 5 Nov 2026.
    const statuses = await listReleaseStatus(
      client([statusRow({ score: "90", last_released_at: "2026-11-05T07:00:00+00:00" })]),
      ["interview-1"],
    )
    if (!statuses.ok) throw new Error(statuses.error)

    const [row] = interviewRows([listed(78)], statuses.data)
    expect(row).toMatchObject({ result: "Passed", score: 90, sentOn: "5 Nov 2026" })
  })

  it("show a result corrected after its release as not sent, with the corrected score", async () => {
    const statuses = await listReleaseStatus(
      client([statusRow({ score: 90, last_released_at: "2026-11-05T07:00:00+00:00", changed_since_sent: true })]),
      ["interview-1"],
    )
    if (!statuses.ok) throw new Error(statuses.error)

    const [row] = interviewRows([listed(78)], statuses.data)
    expect(row).toMatchObject({ score: 90, sentOn: null })
  })

  it("keep the list's values, and claim no send, for an interview the status read did not find", () => {
    const [row] = interviewRows([listed(78)], new Map())
    expect(row).toMatchObject({ result: "Passed", score: 78, sentOn: null })
  })

  it("date a send by the day in Tanzania", async () => {
    const statuses = await listReleaseStatus(
      client([statusRow({ last_released_at: "2026-11-04T22:30:00+00:00" })]),
      ["interview-1"],
    )
    if (!statuses.ok) throw new Error(statuses.error)
    expect(interviewRows([listed(78)], statuses.data)[0].sentOn).toBe("5 Nov 2026")
  })
})
