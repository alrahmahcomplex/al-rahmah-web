import { describe, expect, it } from "vitest"

import { followUpsHref, parseFollowUpSearch } from "@/app/staff/follow-ups/search-params"
import { lastContactText, overdueText, rowDue, splitToday } from "@/app/staff/follow-ups/queue-format"
import { navFor, STAFF_NAV } from "@/app/staff/navigation"

describe("parseFollowUpSearch", () => {
  it("reads each section's page from the URL", () => {
    expect(parseFollowUpSearch({ overdue: "2", upcoming: "3" })).toEqual({ overdue: 2, upcoming: 3 })
  })

  it("falls back to the first page for anything unreadable", () => {
    expect(parseFollowUpSearch({})).toEqual({ overdue: 1, upcoming: 1 })
    expect(parseFollowUpSearch({ overdue: "0", upcoming: "two" })).toEqual({ overdue: 1, upcoming: 1 })
    expect(parseFollowUpSearch({ overdue: "1.5", upcoming: "-1" })).toEqual({ overdue: 1, upcoming: 1 })
    expect(parseFollowUpSearch({ overdue: "10001" })).toEqual({ overdue: 1, upcoming: 1 })
    expect(parseFollowUpSearch({ overdue: ["4", "5"] })).toEqual({ overdue: 4, upcoming: 1 })
  })
})

describe("followUpsHref", () => {
  it("keeps the other section's page and leaves out first pages", () => {
    expect(followUpsHref({ overdue: 1, upcoming: 1 })).toBe("/staff/follow-ups")
    expect(followUpsHref({ overdue: 1, upcoming: 3 }, { overdue: 2 })).toBe("/staff/follow-ups?overdue=2&upcoming=3")
    expect(followUpsHref({ overdue: 2, upcoming: 3 }, { upcoming: 1 })).toBe("/staff/follow-ups?overdue=2")
  })
})

describe("the queue's wording", () => {
  it("says how many days a follow-up is overdue", () => {
    expect(overdueText(1)).toBe("Overdue by 1 day")
    expect(overdueText(12)).toBe("Overdue by 12 days")
  })

  it("labels a row by how late it is, or as needing a follow-up date", () => {
    const today = "2026-10-06"
    expect(rowDue({ kind: "follow_up", dueOn: "2026-10-03", daysOverdue: 3 }, today)).toEqual({ text: "Overdue by 3 days", overdue: true })
    expect(rowDue({ kind: "follow_up", dueOn: "2026-10-06", daysOverdue: 0 }, today)).toEqual({ text: "Due today", overdue: false })
    expect(rowDue({ kind: "follow_up", dueOn: "2026-10-08", daysOverdue: 0 }, today)).toEqual({ text: "Due in 2 days", overdue: false })
    // Approved today or earlier, a reopened lead is overdue all the same.
    expect(rowDue({ kind: "needs_date", dueOn: "2026-10-06", daysOverdue: 0 }, today)).toEqual({ text: "Needs a follow-up date", overdue: true })
    expect(rowDue({ kind: "needs_date", dueOn: "2026-10-01", daysOverdue: 5 }, today)).toEqual({ text: "Needs a follow-up date", overdue: true })
  })

  it("names the last contact's method and date in Tanzania, or says there is none", () => {
    // 21:30 UTC is already the next day in Tanzania.
    expect(lastContactText({ method: "WhatsApp", contactedAt: "2026-10-01T21:30:00Z" })).toBe("Last contact: WhatsApp on 2 Oct 2026")
    expect(lastContactText(null)).toBe("No contact recorded yet")
  })

  it("puts today's follow-ups apart from later ones, keeping their order", () => {
    const item = (dueOn: string) => ({ dueOn })
    expect(splitToday([item("2026-10-06"), item("2026-10-06"), item("2026-10-07")], "2026-10-06")).toEqual({
      today: [item("2026-10-06"), item("2026-10-06")],
      later: [item("2026-10-07")],
    })
    expect(splitToday([item("2026-10-09")], "2026-10-06")).toEqual({ today: [], later: [item("2026-10-09")] })
  })
})

describe("the Follow-ups navigation entry", () => {
  it("shows to anyone who may view leads, and to no one else", () => {
    const followUps = STAFF_NAV.find((entry) => entry.label === "Follow-ups")
    expect(followUps).toEqual({ href: "/staff/follow-ups", label: "Follow-ups", permission: "leads.view" })
    expect(navFor(["leads.view"])).toContain(followUps)
    expect(navFor(["payments.view", "follow_ups.record"])).not.toContain(followUps)
  })
})
