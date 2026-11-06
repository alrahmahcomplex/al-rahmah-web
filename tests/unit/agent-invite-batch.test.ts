import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { batchHeading, batchStopLine, budgetLine, skippedLine } from "@/app/staff/agents/invite-batch-outcome"
import { agentsHref, parseAgentSearch } from "@/app/staff/agents/search-params"
import { dailyBudgetLeft, readInviteBudgetConfig, type InviteBatchReport } from "@/lib/services/agent-invite-batches"

// Invite batches' configuration, budget arithmetic and report wording (#192).

const BATCH_ID = "b0b0b0b0-0000-4000-8000-000000000192"

const REPORT: InviteBatchReport = {
  id: BATCH_ID,
  // 10:00 in Dar es Salaam.
  startedAt: "2026-11-06T07:00:00Z",
  startedBy: "Amina Manager",
  finishedAt: "2026-11-06T07:00:40Z",
  stopReason: "done",
  dailyCap: 100,
  staffReserve: 20,
  batchLimit: 30,
  usedToday: 12,
  waitingAtStart: 5,
  skippedRecent: 0,
  counts: { sent: 3, waiting: 1, noEmail: 2, failed: 1 },
}

describe("the budget's configuration", () => {
  it("reads the daily cap and the staff reserve as whole numbers", () => {
    expect(readInviteBudgetConfig({ EMAIL_DAILY_CAP: "100", STAFF_INVITE_RESERVE: "20" })).toEqual({
      dailyCap: 100,
      staffReserve: 20,
    })
  })

  it("is missing when either value is absent or isn't a whole number", () => {
    expect(readInviteBudgetConfig({ EMAIL_DAILY_CAP: "100" })).toBeNull()
    expect(readInviteBudgetConfig({ STAFF_INVITE_RESERVE: "20" })).toBeNull()
    expect(readInviteBudgetConfig({ EMAIL_DAILY_CAP: "100.5", STAFF_INVITE_RESERVE: "20" })).toBeNull()
    expect(readInviteBudgetConfig({ EMAIL_DAILY_CAP: "-1", STAFF_INVITE_RESERVE: "20" })).toBeNull()
    expect(readInviteBudgetConfig({ EMAIL_DAILY_CAP: "", STAFF_INVITE_RESERVE: "20" })).toBeNull()
  })
})

describe("the daily budget", () => {
  it("is the daily cap less the staff reserve less what went today", () => {
    expect(dailyBudgetLeft({ dailyCap: 100, staffReserve: 20 }, 0)).toBe(80)
    expect(dailyBudgetLeft({ dailyCap: 100, staffReserve: 20 }, 75)).toBe(5)
  })

  it("never goes below zero", () => {
    expect(dailyBudgetLeft({ dailyCap: 100, staffReserve: 20 }, 90)).toBe(0)
    expect(dailyBudgetLeft({ dailyCap: 10, staffReserve: 20 }, 0)).toBe(0)
  })
})

describe("the report", () => {
  it("gives its times in East Africa Time", () => {
    expect(batchHeading(REPORT)).toBe("Started 6 Nov 2026, 10:00 by Amina Manager, finished 6 Nov 2026, 10:00")
  })

  it("tells the hourly limit apart from the daily budget", () => {
    const hourly = batchStopLine({ ...REPORT, stopReason: "hourly_limit" })
    const daily = batchStopLine({ ...REPORT, stopReason: "daily_budget" })

    expect(hourly).toContain("hourly email limit")
    expect(hourly).toContain("This isn't the daily budget")
    expect(daily).toBe(
      "Stopped at today's budget for agent invites: 80 a day (the email service's 100, less 20 kept for staff invites). It resets at 03:00 East Africa Time.",
    )
  })

  it("says the batch limit and the time limit", () => {
    expect(batchStopLine({ ...REPORT, stopReason: "batch_limit" })).toMatch(/^Stopped after 30 invites/)
    expect(batchStopLine({ ...REPORT, stopReason: "time_limit" })).toMatch(/^Stopped at the time one batch may take/)
  })

  it("says an unfinished batch may still be sending, and later that it was cut off", () => {
    const unfinished = { ...REPORT, finishedAt: null, stopReason: null }
    const started = new Date(REPORT.startedAt).getTime()

    expect(batchStopLine(unfinished, started + 30_000)).toMatch(/may still be sending/)
    expect(batchStopLine(unfinished, started + 10 * 60_000)).toMatch(/stopped before it finished/)
    expect(batchHeading(unfinished)).toBe("Started 6 Nov 2026, 10:00 by Amina Manager")
  })

  it("counts those skipped as invited in the last 24 hours", () => {
    expect(skippedLine(REPORT)).toBeNull()
    expect(skippedLine({ ...REPORT, skippedRecent: 4 })).toBe("4 skipped as invited in the last 24 hours.")
  })
})

describe("the budget line", () => {
  it("shows what's used and left today", () => {
    expect(budgetLine({ dailyCap: 100, staffReserve: 20 }, 12)).toBe(
      "Today's budget for agent invites: 12 of 80 used, 68 left. That's 80 a day (the email service's 100, less 20 kept for staff invites); it resets at 03:00 East Africa Time.",
    )
  })

  it("says when the budget isn't configured", () => {
    expect(budgetLine(null, null)).toMatch(/isn't configured \(EMAIL_DAILY_CAP and STAFF_INVITE_RESERVE\)/)
  })
})

describe("a batch's links", () => {
  it("keep the batch and the count in the URL", () => {
    const search = parseAgentSearch({ status: "approved", account: "no-account", batch: BATCH_ID, outcome: "no-email" }, true)

    expect(search).toMatchObject({ account: "no_account", batchId: BATCH_ID, batchOutcome: "no_email" })
    expect(agentsHref(search)).toBe(`/staff/agents?status=approved&account=no-account&batch=${BATCH_ID}&outcome=no-email`)
  })

  it("ignore a malformed batch id", () => {
    expect(parseAgentSearch({ batch: "nope", outcome: "sent" }, true)).not.toHaveProperty("batchId")
  })
})
