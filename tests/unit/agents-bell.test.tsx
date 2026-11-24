import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/app/actions/session", () => ({ signOutLocalAndReturn: vi.fn() }))

import { AgentsBell } from "@/app/(agents)/agents-shell"
import {
  BELL_LAST_OPENED_KEY,
  countUnreadRecent,
  openedAtFor,
  readLastOpenedAt,
  writeLastOpenedAt,
} from "@/app/(agents)/bell-state"
import type { AgentRecentChange } from "@/lib/services/agent-students"

function item(id: string, status: AgentRecentChange["status"], changedAt: string, days = 0): AgentRecentChange {
  return { id, name: `Student ${id}`, status, days, changedAt }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("agents bell timestamp unread state (#539)", () => {
  it("keeps clearing the badge even after more than 50 prior entries have been read", async () => {
    const user = userEvent.setup()
    const baseMs = Date.parse("2026-11-20T08:00:00.000Z")

    // Simulate 60 earlier entries being opened and read across time.
    for (let i = 1; i <= 60; i++) {
      const changedAt = new Date(baseMs + i * 60_000).toISOString()
      const openedAt = new Date(baseMs + i * 60_000 + 1_000).toISOString()
      writeLastOpenedAt(openedAt)
      expect(countUnreadRecent([item(`s-${i}`, "Applied", changedAt)], readLastOpenedAt())).toBe(0)
    }

    // A 61st entry arrives later; opening the bell clears it cleanly with no cap.
    const latest = item("s-61", "Visited", new Date(baseMs + 70 * 60_000).toISOString())
    render(<AgentsBell language="en" recent={[latest]} />)

    expect(screen.getByRole("button", { name: "What’s new (1)" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "What’s new (1)" }))
    expect(screen.getByRole("button", { name: "What’s new" })).toBeInTheDocument()
    expect(countUnreadRecent([latest], readLastOpenedAt())).toBe(0)
  })

  it("marks a same-step change on an already-read student as unread again", async () => {
    const user = userEvent.setup()
    const firstChange = item("lead-1", "Interviewed", "2026-11-24T09:00:00.000Z")

    const { rerender } = render(<AgentsBell language="en" recent={[firstChange]} />)
    expect(screen.getByRole("button", { name: "What’s new (1)" })).toBeInTheDocument()

    // Opening the bell marks the first Interviewed change as read.
    await user.click(screen.getByRole("button", { name: "What’s new (1)" }))
    expect(screen.getByRole("button", { name: "What’s new" })).toBeInTheDocument()

    // Close the popover before the new change arrives.
    await user.click(screen.getByRole("button", { name: "Close" }))

    // Later, a paid result or name/class fix arrives while status stays Interviewed.
    const laterTs = new Date(Date.parse(readLastOpenedAt()!) + 60_000).toISOString()
    const sameStepChange = item("lead-1", "Interviewed", laterTs)
    rerender(<AgentsBell language="en" recent={[sameStepChange]} />)

    expect(screen.getByRole("button", { name: "What’s new (1)" })).toBeInTheDocument()

    // Opening the bell again clears the new change too.
    await user.click(screen.getByRole("button", { name: "What’s new (1)" }))
    expect(screen.getByRole("button", { name: "What’s new" })).toBeInTheDocument()
  })

  it("treats all 7-day entries as unread when localStorage is unavailable, without throwing", async () => {
    const user = userEvent.setup()
    const blocked = new Error("SecurityError: storage blocked")
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw blocked
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw blocked
    })

    const recent = [
      item("a", "Applied", "2026-11-23T08:00:00.000Z", 1),
      item("b", "Visited", "2026-11-24T08:00:00.000Z", 0),
    ]
    render(<AgentsBell language="en" recent={recent} />)

    expect(screen.getByRole("button", { name: "What’s new (2)" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "What’s new (2)" }))
    // Storage stays unavailable, so the safe default remains all 7-day entries unread.
    expect(screen.getByRole("button", { name: "What’s new (2)" })).toBeInTheDocument()
  })

  it("handles corrupt stored values and minor device clock lag cleanly", () => {
    window.localStorage.setItem(BELL_LAST_OPENED_KEY, "[]")
    expect(readLastOpenedAt()).toBeNull()

    const futureFromDb = item("c", "Interviewed", "2026-11-24T12:00:05.123456+00:00")
    expect(countUnreadRecent([futureFromDb], readLastOpenedAt())).toBe(1)

    const openedAt = openedAtFor([futureFromDb], null)
    expect(countUnreadRecent([futureFromDb], openedAt)).toBe(0)
  })

  it("saves the newest shown change time, so a change made after the page loaded stays unread", () => {
    const shown = [item("a", "Applied", "2026-11-24T09:00:00.000Z")]
    const openedAt = openedAtFor(shown, null)
    expect(openedAt).toBe("2026-11-24T09:00:00.000Z")

    const afterReload = [item("b", "Interviewed", "2026-11-24T09:05:00.000Z"), ...shown]
    expect(countUnreadRecent(afterReload, openedAt)).toBe(1)
  })

  it("keeps the saved time when it is newer, and saves nothing for an empty list", () => {
    const saved = "2026-11-24T10:00:00.000Z"
    expect(openedAtFor([item("a", "Applied", "2026-11-24T09:00:00.000Z")], saved)).toBe(saved)
    expect(openedAtFor([], saved)).toBe(saved)
    expect(openedAtFor([], null)).toBeNull()
  })
})
