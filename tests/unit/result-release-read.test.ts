import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { getResultRelease } from "@/lib/services/result-release"

// Reading the Result release section while someone else corrects the score
// and sends it, with the database stubbed so the reads interleave.

const OFFICE = { officePhone: "+255 673 526 644" }

function state(score: number) {
  return {
    interview_id: "interview-1",
    blocked: null,
    amount_owed: null,
    can_send: true,
    channel: "whatsapp",
    whatsapp_phone: "+255700000601",
    whatsapp_fits: true,
    direct_phone: "+255700000601",
    result: "Passed",
    score,
    parent_name: "Release Parent",
    student_name: "Candidate One",
    admission_number: "ADMSN-00601",
    class_name: "STD 4",
    enrollment_year: 2027,
  }
}

function release(score: number) {
  return {
    released_at: "2026-10-03T11:05:00Z",
    released_by: "Amina Staff",
    channel: "whatsapp",
    number_used: "whatsapp",
    result: "Passed",
    score,
    template_id: "result-passed-whatsapp-v1",
  }
}

// Answers each result_release_state call with the next row, and every
// result_releases call with the releases.
function client(states: object[], releases: object[]) {
  const answers = [...states]
  return {
    rpc: async (name: string) =>
      name === "result_release_state" ? { data: answers.shift() ?? states.at(-1), error: null } : { data: releases, error: null },
  } as unknown as SupabaseClient
}

describe("reading the Result release section", () => {
  it("compares the releases with the result read after them, so a correction sent meanwhile is no warning", async () => {
    // 78 was sent; then, between the first read and the releases, the score
    // was corrected to 90 and sent again.
    const read = await getResultRelease(client([state(78), state(90)], [release(90), release(78)]), "lead-1", OFFICE)
    if (!read.ok) throw new Error(read.error)
    expect(read.data.changedSinceSent).toBe(false)
    expect(read.data.offer?.whatsappMessage).toContain("90%")
  })

  it("warns when the result read after the releases differs from the last one sent", async () => {
    const read = await getResultRelease(client([state(78), state(90)], [release(78)]), "lead-1", OFFICE)
    if (!read.ok) throw new Error(read.error)
    expect(read.data.changedSinceSent).toBe(true)
    expect(read.data.offer?.whatsappMessage).toContain("90%")
  })
})
