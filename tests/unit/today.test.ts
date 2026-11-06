import { describe, expect, it } from "vitest"

import { firstName, greeting, initials } from "@/app/staff/_today/greeting"
import { mayActOn, namesLine, QUEUE_ROW_KEYS, queueRows, summaryLine, type QueueInput } from "@/app/staff/_today/queue"
import { formatLongDate, tanzaniaHour } from "@/lib/school-calendar"

// The seeded roles' permissions, from the roles migration.
const ADMISSIONS_STAFF = [
  "leads.view",
  "leads.create",
  "leads.edit",
  "visits.record",
  "interviews.record",
  "results.send",
  "follow_ups.record",
  "leads.decline",
  "leads.close",
  "payments.view",
  "group_links.manage",
] as const
const ADMISSIONS_MANAGER = [
  ...ADMISSIONS_STAFF,
  "reopenings.approve",
  "lifecycle.intervene",
  "agents.approve",
  "discounts.approve",
  "academic_years.manage",
  "staff.administer",
] as const
const ACCOUNTANT = ["leads.view", "interview_payments.record", "payments.view", "payments.record"] as const

describe("the greeting", () => {
  it("says good morning until noon and good afternoon after it", () => {
    expect(greeting(0)).toBe("Good morning")
    expect(greeting(11)).toBe("Good morning")
    expect(greeting(12)).toBe("Good afternoon")
    expect(greeting(23)).toBe("Good afternoon")
  })

  it("uses the first word of the name", () => {
    expect(firstName("Test Manager")).toBe("Test")
    expect(firstName("  Amina   Juma ")).toBe("Amina")
    expect(firstName("Mononym")).toBe("Mononym")
  })

  it("reads the hour in Tanzania, three hours ahead of UTC", () => {
    expect(tanzaniaHour(new Date("2026-11-06T21:30:00Z"))).toBe(0)
    expect(tanzaniaHour(new Date("2026-11-06T08:59:00Z"))).toBe(11)
    expect(tanzaniaHour(new Date("2026-11-06T09:00:00Z"))).toBe(12)
  })

  it("writes the date out in full", () => {
    expect(formatLongDate("2026-11-06")).toBe("Friday 6 November 2026")
    expect(formatLongDate("2027-01-01")).toBe("Friday 1 January 2027")
  })
})

describe("initials", () => {
  it("takes the first letters of the first and last names", () => {
    expect(initials("Rukia Maandalizi")).toBe("RM")
    expect(initials("Imani A. Kiwelu")).toBe("IK")
    expect(initials("Amani")).toBe("A")
    expect(initials("  baraka  fixture ")).toBe("BF")
  })
})

describe("mayActOn", () => {
  it("gives Admissions Staff the rows they work, and none of the Manager's decisions", () => {
    expect(mayActOn("overdue", ADMISSIONS_STAFF)).toBe(true)
    expect(mayActOn("interviews", ADMISSIONS_STAFF)).toBe(true)
    expect(mayActOn("reApplications", ADMISSIONS_STAFF)).toBe(true)
    expect(mayActOn("results", ADMISSIONS_STAFF)).toBe(true)
    expect(mayActOn("agents", ADMISSIONS_STAFF)).toBe(false)
    expect(mayActOn("discounts", ADMISSIONS_STAFF)).toBe(false)
    expect(mayActOn("reopenings", ADMISSIONS_STAFF)).toBe(false)
  })

  it("gives the Admissions Manager every row", () => {
    for (const key of QUEUE_ROW_KEYS) expect(mayActOn(key, ADMISSIONS_MANAGER)).toBe(true)
  })

  it("gives the Accountant, who reads leads but acts on none of this, no row", () => {
    for (const key of QUEUE_ROW_KEYS) expect(mayActOn(key, ACCOUNTANT)).toBe(false)
  })

  it("needs leads.view with a decision that is made on the lead's screen", () => {
    expect(mayActOn("reopenings", ["reopenings.approve"])).toBe(false)
    expect(mayActOn("reopenings", ["reopenings.approve", "leads.view"])).toBe(true)
    expect(mayActOn("agents", ["agents.approve"])).toBe(false)
    expect(mayActOn("agents", ["agents.approve", "leads.view"])).toBe(true)
  })
})

const EVERYTHING: QueueInput = {
  overdue: { count: 8, oldest: { kind: "follow_up", studentName: "Zuberi Pendo", dueOn: "2026-11-02" } },
  interviews: { count: 3, students: ["Rukia Maandalizi", "Amani Kiwelu", "Bahati Ndugu"], year: 2027 },
  reApplications: { count: 2 },
  results: { count: 5, year: 2027 },
  agents: { count: 1 },
  discounts: { count: 2 },
  reopenings: { count: 1 },
}

describe("queueRows", () => {
  it("shows nothing when nothing was read", () => {
    expect(queueRows({})).toEqual([])
  })

  it("hides a row whose count is zero", () => {
    expect(queueRows({ overdue: { count: 0, oldest: null }, reApplications: { count: 0 }, results: { count: 0, year: null } })).toEqual([])
  })

  it("lists the rows in order, each with its screen, count and lines", () => {
    const rows = queueRows(EVERYTHING)
    expect(rows.map((row) => row.key)).toEqual([...QUEUE_ROW_KEYS])
    expect(rows.map((row) => row.href)).toEqual([
      "/staff/follow-ups",
      "/staff/interviews?year=2027",
      "/staff/re-applications",
      "/staff/interviews?year=2027&release=ready",
      "/staff/agents?status=pending",
      "/staff/discounts",
      "/staff/reopenings",
    ])
    expect(rows.map((row) => row.title)).toEqual([
      "8 follow-ups are overdue",
      "3 interviews today",
      "2 re-applications to review",
      "5 results ready to send",
      "1 Marketing Agent waiting for approval",
      "2 Discount requests pending",
      "1 Reopening request pending",
    ])
    expect(rows[0].detail).toBe("Oldest: Zuberi Pendo, due 2 Nov 2026")
    expect(rows[1].detail).toBe("Rukia Maandalizi · Amani Kiwelu · Bahati Ndugu")
    expect(rows[3].detail).toBe("Interview fee paid, result not yet sent to the parent")
    expect(rows.map((row) => row.count)).toEqual([8, 3, 2, 5, 1, 2, 1])
  })

  it("speaks in the singular for one", () => {
    const rows = queueRows({ overdue: { count: 1, oldest: null }, interviews: { count: 1, students: ["Amani"], year: null }, results: { count: 1, year: 2028 } })
    expect(rows.map((row) => row.title)).toEqual(["1 follow-up is overdue", "1 interview today", "1 result ready to send"])
    expect(rows[0].detail).toBe("Families waiting for a call")
  })

  it("says when the oldest overdue item is a reopened lead with no follow-up date", () => {
    const [row] = queueRows({ overdue: { count: 2, oldest: { kind: "needs_date", studentName: "Amani Rejea", dueOn: "2026-11-03" } } })
    expect(row.detail).toBe("Oldest: Amani Rejea, reopened 3 Nov 2026 with no follow-up date")
  })

  it("opens the Interviews screen on the year of the day's first interview", () => {
    expect(queueRows({ interviews: { count: 2, students: ["A", "B"], year: 2028 } })[0].href).toBe("/staff/interviews?year=2028")
    expect(queueRows({ interviews: { count: 1, students: ["A"], year: null } })[0].href).toBe("/staff/interviews")
  })

  it("opens Ready to send on the earliest year with a result waiting", () => {
    expect(queueRows({ results: { count: 2, year: 2028 } })[0].href).toBe("/staff/interviews?year=2028&release=ready")
    expect(queueRows({ results: { count: 2, year: null } })[0].href).toBe("/staff/interviews?release=ready")
  })

  it("formats large counts for a reader", () => {
    expect(queueRows({ reApplications: { count: 1200 } })[0].title).toBe("1,200 re-applications to review")
  })
})

describe("namesLine", () => {
  it("names up to three students and counts the rest", () => {
    expect(namesLine(["Rukia", "Amani", "Bahati"], 3)).toBe("Rukia · Amani · Bahati")
    expect(namesLine(["Rukia", "Amani", "Bahati"], 5)).toBe("Rukia · Amani · Bahati and 2 more")
    expect(namesLine(["Rukia", "Amani", "Bahati"], 4)).toBe("Rukia · Amani · Bahati and 1 more")
    expect(namesLine(["Rukia"], 1)).toBe("Rukia")
    expect(namesLine([], 2)).toBe("Interviews held today")
  })
})

describe("summaryLine", () => {
  it("joins every row's count into one line", () => {
    expect(summaryLine(queueRows(EVERYTHING))).toBe(
      "8 overdue follow-ups, 3 interviews today, 2 re-applications to review, 5 results to send, 1 agent to approve, 2 discount requests, 1 reopening request",
    )
  })

  it("is empty when nothing waits", () => {
    expect(summaryLine([])).toBe("")
  })
})
