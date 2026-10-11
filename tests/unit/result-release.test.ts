import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/leads/[id]/history/describe"
import { blockedText, releaseLine, releaseRefusal, spacedPhone } from "@/app/staff/leads/[id]/result-release-outcome"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import type { ReleaseError } from "@/lib/services/result-release"

const INTERVIEW = "22222222-2222-4222-8222-222222222222"

const change = (field: string, to: unknown) => ({ field, from: null, to })

function release(details: Record<string, unknown>): LeadHistoryEntry {
  return {
    id: 7,
    at: "2026-10-03T07:15:00Z",
    actor: "Amina Staff",
    record: null,
    recordId: null,
    action: "result_released",
    changes: Object.entries(details).map(([field, to]) => change(field, to)),
  }
}

describe("a result release in the lead's history", () => {
  it("reads as the result sent by WhatsApp, with the result and score, the number used and the template", () => {
    const [described] = describeLeadHistory(
      [
        release({
          interview_id: INTERVIEW,
          serial_number: 4,
          channel: "whatsapp",
          number_used: "whatsapp",
          result: "Passed",
          score: 78,
          template_id: "whatsapp_passed_v1",
        }),
      ],
      {},
    )
    expect(described.summary).toBe("sent the result by WhatsApp: Passed, 78%")
    expect(described.changes).toEqual([
      { label: "S/N", from: null, to: "4" },
      { label: "Sent to", from: null, to: "The parent's WhatsApp number" },
      { label: "Message", from: null, to: "WhatsApp, Passed (version 1)" },
    ])
  })

  it("shows a score with one decimal place as stored, and the direct phone", () => {
    const [described] = describeLeadHistory(
      [
        release({
          interview_id: INTERVIEW,
          serial_number: 2,
          channel: "whatsapp",
          number_used: "direct",
          result: "Failed",
          score: 41.5,
          template_id: "whatsapp_failed_v1",
        }),
      ],
      {},
    )
    expect(described.summary).toBe("sent the result by WhatsApp: Failed, 41.5%")
    expect(described.changes).toContainEqual({ label: "Sent to", from: null, to: "The parent's direct phone" })
  })

  it("leaves other action events reading as before", () => {
    const [described] = describeLeadHistory([{ ...release({}), action: "invite_sent" }], {})
    expect(described.summary).toBe("recorded invite_sent")
  })
})

describe("the Result release section's words", () => {
  it("says why the result can't go yet, with the amount owed while Not Paid", () => {
    expect(blockedText("not_paid", 30000)).toBe(
      "The result can't be sent until the interview fee is Paid. The family owes TZS 30,000.",
    )
    expect(blockedText("no_interview", null)).toBe("There is no interview yet, so there is no result to send.")
    expect(blockedText("no_result", null)).toBe("No result is recorded yet, so there is nothing to send.")
    expect(blockedText("lead_closed", null)).toBe("This lead is closed, so its result can't be sent.")
  })

  it("gives the last release by channel, Tanzanian date and name", () => {
    // 22:30 in UTC is already the next day in Tanzania.
    expect(releaseLine({ channel: "whatsapp", releasedAt: "2026-10-02T22:30:00Z", releasedBy: "Amina" })).toBe(
      "Sent by WhatsApp on 3 Oct 2026 by Amina",
    )
  })

  it("spaces a Tanzanian number for reading, and leaves any other as stored", () => {
    expect(spacedPhone("+255700000602")).toBe("+255 700 000 602")
    expect(spacedPhone("+447700900123")).toBe("+447700900123")
  })

  it("turns every refusal into a sentence without its code", () => {
    const errors: ReleaseError[] = [
      "forbidden",
      "not-found",
      "unavailable",
      "lead_closed",
      "not_current",
      "no_result",
      "not_paid",
      "no_whatsapp_number",
      "too_long",
    ]
    for (const error of errors) {
      const outcome = releaseRefusal(error)
      expect(outcome.status).toBe("refused")
      if (outcome.status === "refused") expect(outcome.message).not.toMatch(/_|not-found|forbidden|unavailable/)
    }
  })
})
