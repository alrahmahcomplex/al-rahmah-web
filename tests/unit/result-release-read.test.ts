import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { getResultRelease } from "@/lib/services/result-release"

// Reading the Result release section while someone else corrects the score
// and sends it, with the database stubbed so the reads interleave.

const OFFICE = { officePhone: "+255 673 526 644" }

// changed: what interview_release_status answered in the same read.
function state(score: number, changed: boolean) {
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
    changed_since_sent: changed,
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
  it("takes changed since sent from the read after the releases, so a correction sent meanwhile is no warning", async () => {
    // 78 was sent and corrected to 90, so the first read says changed; then,
    // before the releases were read, 90 was sent too.
    const read = await getResultRelease(client([state(78, true), state(90, false)], [release(90), release(78)]), "lead-1", OFFICE)
    if (!read.ok) throw new Error(read.error)
    expect(read.data.changedSinceSent).toBe(false)
    expect(read.data.offer?.whatsappMessage).toContain("90%")
  })

  it("warns when the read after the releases says the result changed since the last one sent", async () => {
    const read = await getResultRelease(client([state(78, false), state(90, true)], [release(78)]), "lead-1", OFFICE)
    if (!read.ok) throw new Error(read.error)
    expect(read.data.changedSinceSent).toBe(true)
    expect(read.data.offer?.whatsappMessage).toContain("90%")
  })
})

describe("whether the result changed since sent", () => {
  it("is never claimed without a release to compare with", async () => {
    const read = await getResultRelease(client([state(78, true)], []), "lead-1", OFFICE)
    if (!read.ok) throw new Error(read.error)
    expect(read.data.changedSinceSent).toBe(false)
  })

  it("is the database's answer, not a comparison made here", async () => {
    // The release and the result agree, but the database says changed: the
    // service follows the database.
    const read = await getResultRelease(client([state(78, true), state(78, true)], [release(78)]), "lead-1", OFFICE)
    if (!read.ok) throw new Error(read.error)
    expect(read.data.changedSinceSent).toBe(true)
  })
})
