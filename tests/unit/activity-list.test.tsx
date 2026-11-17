import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Home's Activity log card (#406): it follows a fresh read from the server,
// moves back when the log shrinks under an open page, and goes when the log
// empties. Which roles see the card at all is mayReadActivity.

const { load } = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock("@/app/staff/_home/activity-actions", () => ({ loadActivityPage: load }))

import type { ActivityView } from "@/app/staff/_home/activity"
import { mayReadActivity, type ActivityScreenPage } from "@/app/staff/_home/activity-data"
import { ActivityList } from "@/app/staff/_home/activity-list"

const row = (who: string): ActivityView => ({
  key: `call_back:${who}`,
  time: "Today",
  icon: "followups",
  task: "Call back",
  who,
  about: "father of AMANI",
  details: "Due today.",
  action: null,
  recordedBy: null,
  note: null,
})

const page = (whos: string[], { total = whos.length, page: at = 1 }: { total?: number; page?: number } = {}): ActivityScreenPage => ({
  rows: whos.map(row),
  total,
  page: at,
  pageCount: Math.max(1, Math.ceil(total / 10)),
})

const rowFor = (who: string) => screen.queryByRole("button", { name: new RegExp(`^Call back, ${who} ·`) })

beforeEach(() => load.mockReset())

describe("the Activity log card", () => {
  it("shows the new first page when Home reads the log again", () => {
    const view = render(<ActivityList first={page(["OLD CALLER"])} />)
    expect(rowFor("OLD CALLER")).not.toBeNull()
    view.rerender(<ActivityList first={page(["NEW CALLER"])} />)
    expect(rowFor("NEW CALLER")).not.toBeNull()
    expect(rowFor("OLD CALLER")).toBeNull()
  })

  it("goes to the new last page when the log shrank under the page asked for", async () => {
    load.mockResolvedValueOnce({ status: "ok", page: page([], { total: 1, page: 2 }) })
    load.mockResolvedValueOnce({ status: "ok", page: page(["LAST LEFT"], { total: 1, page: 1 }) })
    render(<ActivityList first={page(["FIRST"], { total: 11 })} />)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(rowFor("LAST LEFT")).not.toBeNull())
    expect(load.mock.calls).toEqual([[2], [1]])
  })

  it("goes when nothing is left in the log", async () => {
    load.mockResolvedValueOnce({ status: "ok", page: page([], { total: 0, page: 2 }) })
    render(<ActivityList first={page(["FIRST"], { total: 11 })} />)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(screen.queryByRole("region", { name: "Activity log" })).toBeNull())
  })

  it("says so when a page can't be read, and keeps the rows it has", async () => {
    load.mockResolvedValueOnce({ status: "refused", message: "The Activity log could not be loaded. Try again in a moment." })
    render(<ActivityList first={page(["FIRST"], { total: 11 })} />)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("The Activity log could not be loaded. Try again in a moment.")
    expect(rowFor("FIRST")).not.toBeNull()
  })
})

describe("who sees the card", () => {
  it("staff who may view applicants, or who may open Seats", () => {
    expect(mayReadActivity(["leads.view"])).toBe(true)
    expect(mayReadActivity(["payments.view", "academic_years.manage"])).toBe(true)
    expect(mayReadActivity(["payments.view"])).toBe(false)
    expect(mayReadActivity(["agents.approve"])).toBe(false)
    expect(mayReadActivity([])).toBe(false)
  })
})
