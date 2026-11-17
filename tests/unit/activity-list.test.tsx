import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
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

  it("keeps the fresh rows when a page asked for before the fresh read answers late", async () => {
    let answer: (value: unknown) => void = () => {}
    load.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const view = render(<ActivityList first={page(["FIRST"], { total: 11 })} />)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    view.rerender(<ActivityList first={page(["FRESH"], { total: 11 })} />)
    answer({ status: "ok", page: page(["STALE PAGE TWO"], { total: 11, page: 2 }) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(rowFor("FRESH")).not.toBeNull()
    expect(rowFor("STALE PAGE TWO")).toBeNull()
  })

  it("keeps the fresh rows when the late answer lands right after the fresh read commits, before effects run", async () => {
    let answer: (value: unknown) => void = () => {}
    load.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const before = actEnvironment.IS_REACT_ACT_ENVIRONMENT
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    try {
      flushSync(() => root.render(<ActivityList first={page(["FIRST"], { total: 11 })} />))
      fireEvent.click(screen.getByRole("button", { name: "Next page" }))
      // A mutation observer runs as a microtask straight after React writes
      // the fresh rows, before its passive effects run in a later task: the
      // late answer lands in exactly that gap.
      const landed = new Promise<void>((resolve) => {
        const watch = new MutationObserver(() => {
          if (!host.textContent?.includes("FRESH")) return
          watch.disconnect()
          answer({ status: "ok", page: page(["STALE PAGE TWO"], { total: 11, page: 2 }) })
          resolve()
        })
        watch.observe(host, { childList: true, subtree: true, characterData: true })
      })
      root.render(<ActivityList first={page(["FRESH"], { total: 11 })} />)
      await landed
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(rowFor("FRESH")).not.toBeNull()
      expect(rowFor("STALE PAGE TWO")).toBeNull()
    } finally {
      root.unmount()
      host.remove()
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = before
    }
  })

  it("shows the page asked for last when two answers arrive out of order", async () => {
    let first: (value: unknown) => void = () => {}
    load.mockReturnValueOnce(new Promise((resolve) => (first = resolve)))
    load.mockResolvedValueOnce({ status: "ok", page: page(["PAGE TWO"], { total: 21, page: 2 }) })
    render(<ActivityList first={page(["FIRST"], { total: 21 })} />)
    fireEvent.click(screen.getByRole("button", { name: /^3$/ }))
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(rowFor("PAGE TWO")).not.toBeNull())
    first({ status: "ok", page: page(["PAGE THREE"], { total: 21, page: 3 }) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(rowFor("PAGE TWO")).not.toBeNull()
    expect(rowFor("PAGE THREE")).toBeNull()
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
