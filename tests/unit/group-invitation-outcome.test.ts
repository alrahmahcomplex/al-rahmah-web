import { describe, expect, it } from "vitest"

import { invitationRefusal, sentLine } from "@/app/staff/applicants/[id]/group-invitation-outcome"

const SENT = { year: 2027, sentAt: "2026-11-03T09:30:00Z", sentBy: "Amina Salim" }

describe("the sent line", () => {
  it("says who sent the invitation to which year's group, and when, never that it was received", () => {
    const line = sentLine({ ...SENT, withNames: [] })
    expect(line).toMatch(/^Invitation to the 2027 group sent on .+2026 by Amina Salim\.$/)
    expect(line).not.toMatch(/receiv|join/i)
  })

  it("names the other children the invitation covered", () => {
    expect(sentLine({ ...SENT, withNames: ["Juma Ali"] })).toMatch(/by Amina Salim \(with Juma Ali\)\.$/)
    expect(sentLine({ ...SENT, withNames: ["Juma Ali", "Neema Ali"] })).toMatch(/\(with Juma Ali, Neema Ali\)\.$/)
  })
})

describe("refusals", () => {
  it("after a copy, warns not to send what was copied", () => {
    const refused = invitationRefusal("stale_link", "copy")
    expect(refused.status === "refused" && refused.message).toContain("Don't send what you copied.")
    const linked = invitationRefusal("stale_link", "link")
    expect(linked.status === "refused" && linked.message).not.toContain("copied")
  })
})
