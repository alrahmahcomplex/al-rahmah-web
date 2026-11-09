import { describe, expect, it } from "vitest"

import { describeLeadHistory } from "@/app/staff/applicants/[id]/history/describe"
import {
  blockedText,
  changedSinceSentText,
  releaseLine,
  releaseRefusal,
  repeatSendText,
  smsNote,
  spacedPhone,
} from "@/app/staff/applicants/[id]/result-release-outcome"
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

  it("reads as the result sent by SMS to the direct phone", () => {
    const [described] = describeLeadHistory(
      [
        release({
          interview_id: INTERVIEW,
          serial_number: 6,
          channel: "sms",
          number_used: "direct",
          result: "Failed",
          score: 45,
          template_id: "sms_failed_v1",
        }),
      ],
      {},
    )
    expect(described.summary).toBe("sent the result by SMS: Failed, 45%")
    expect(described.changes).toEqual([
      { label: "S/N", from: null, to: "6" },
      { label: "Sent to", from: null, to: "The parent's direct phone" },
      { label: "Message", from: null, to: "SMS, Failed (version 1)" },
    ])
  })

  it("leaves other action events reading as before", () => {
    const [described] = describeLeadHistory([{ ...release({}), action: "invite_sent" }], {})
    expect(described.summary).toBe("recorded invite_sent")
  })
})

describe("the Result release section's words", () => {
  it("says why the result can't go yet, with the amount owed while Not Paid", () => {
    expect(blockedText("not_paid", 40000)).toBe(
      "The result can't be sent until the interview fee is Paid. The family owes TZS 40,000.",
    )
    expect(blockedText("no_interview", null)).toBe("There is no interview yet, so there is no result to send.")
    expect(blockedText("no_result", null)).toBe("No result is recorded yet, so there is nothing to send.")
    expect(blockedText("lead_closed", null)).toBe("This application is closed, so its result can't be sent.")
  })

  it("gives the last release by channel, Tanzanian date and name", () => {
    // 22:30 in UTC is already the next day in Tanzania.
    expect(releaseLine({ channel: "whatsapp", releasedAt: "2026-10-02T22:30:00Z", releasedBy: "Amina" })).toBe(
      "Sent by WhatsApp on 3 Oct 2026 by Amina",
    )
  })

  it("gives the last release by SMS", () => {
    expect(releaseLine({ channel: "sms", releasedAt: "2026-10-03T07:15:00Z", releasedBy: "Amina" })).toBe(
      "Sent by SMS on 3 Oct 2026 by Amina",
    )
  })

  it("adds no note to an all GSM-7 SMS text in one or two messages", () => {
    expect(smsNote({ gsm7: true, segments: 1 })).toBeNull()
    expect(smsNote({ gsm7: true, segments: 2 })).toBeNull()
  })

  it("notes an SMS text past two messages, and one with a character outside the basic SMS alphabet", () => {
    expect(smsNote({ gsm7: true, segments: 3 })).toBe("The SMS text takes 3 messages, more than the usual two.")
    expect(smsNote({ gsm7: false, segments: 2 })).toBe(
      "A name has a character basic phones may not show, so the SMS text takes 2 messages and may cost more than usual.",
    )
    expect(smsNote({ gsm7: false, segments: 4 })).toBe(
      "A name has a character basic phones may not show, so the SMS text takes 4 messages and may cost more than usual.",
    )
  })

  it("spaces a Tanzanian number for reading, and leaves any other as stored", () => {
    expect(spacedPhone("+255700000602")).toBe("+255 700 000 602")
    expect(spacedPhone("+447700900123")).toBe("+447700900123")
  })

  it("tells a page that missed a release to reload, and that nothing was sent", () => {
    expect(releaseRefusal("sent_meanwhile")).toEqual({
      status: "refused",
      message: "This result was sent by someone else meanwhile, so nothing was sent. Reload to see it.",
    })
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
      "sent_meanwhile",
    ]
    for (const error of errors) {
      const outcome = releaseRefusal(error)
      expect(outcome.status).toBe("refused")
      if (outcome.status === "refused") expect(outcome.message).not.toMatch(/_|not-found|forbidden|unavailable/)
    }
  })
})

describe("sending a result again", () => {
  const last = {
    channel: "whatsapp" as const,
    // 14:05 in Tanzania, three hours ahead of UTC.
    releasedAt: "2026-10-03T11:05:00Z",
    releasedBy: "Amina Staff",
    result: "Passed" as const,
    score: 78,
  }

  it("asks first, saying when, how and by whom it was last sent, and what it carried", () => {
    expect(repeatSendText(last, false)).toBe(
      "It was already sent by WhatsApp on 3 Oct 2026 at 14:05 by Amina Staff, as Passed, 78%. Send it again only if the family lost the message or changed number.",
    )
  })

  it("gives the time in Tanzania, by SMS too", () => {
    expect(repeatSendText({ ...last, channel: "sms", releasedAt: "2026-10-02T22:30:00Z", score: 41.5 }, false)).toMatch(
      /^It was already sent by SMS on 3 Oct 2026 at 01:30 by Amina Staff, as Passed, 41\.5%\./,
    )
  })

  it("says a corrected result goes in place of the one sent", () => {
    expect(repeatSendText(last, true)).toBe(
      "It was already sent by WhatsApp on 3 Oct 2026 at 14:05 by Amina Staff, as Passed, 78%. The result or score has been corrected since, so this sends the corrected result.",
    )
  })

  it("warns that the result or score changed since it was sent, without blocking", () => {
    expect(changedSinceSentText(last)).toBe(
      "The result or score has been corrected since it was last sent, as Passed, 78%. Send it again so the family has the corrected result.",
    )
  })
})
