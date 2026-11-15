import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Timeline } from "@/components/kit"

// The kit's Timeline (prototype v38, Design system → Timeline): a named list,
// one item per entry in the order given, each with its title, meta line and
// anything more under them. Screenshots in the PR cover the look.

describe("Timeline", () => {
  it("is a list named by its label, one item per entry in the order given", () => {
    render(
      <Timeline
        label="History"
        items={[
          { key: 2, title: "Rehema M. changed the application", meta: "15 Nov 2026, 09:12", children: <p>Class: STD 3 → STD 4</p> },
          { key: 1, title: "Rehema M. created the application", meta: "14 Nov 2026, 16:40", tone: "ok" },
        ]}
      />,
    )
    const items = within(screen.getByRole("list", { name: "History" })).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("Rehema M. changed the application15 Nov 2026, 09:12Class: STD 3 → STD 4")
    expect(items[1]).toHaveTextContent("Rehema M. created the application14 Nov 2026, 16:40")
  })

  it("leaves the meta line out when there is none", () => {
    render(<Timeline label="History" items={[{ key: 1, title: "Application received" }]} />)
    expect(screen.getByRole("listitem")).toHaveTextContent(/^Application received$/)
  })
})
