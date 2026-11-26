import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import type { DescribedAuditEntry } from "@/app/staff/_audit-words"
import { AuditFiltersForm } from "@/app/staff/audit/audit-filters"
import { AuditTable } from "@/app/staff/audit/audit-table"

const SAMPLE: DescribedAuditEntry[] = [
  {
    id: 1,
    at: "2026-11-22T07:02:00Z",
    when: "22 Nov 2026, 10:02",
    actor: "Zawadi Mrema",
    area: "lead",
    areaLabel: "Applicants",
    event: "Changed the application",
    record: { kind: "Applicant", title: "Amina Juma", subtitle: "ADMSN-40719" },
    changes: [
      { label: "Class", from: "STD 3", to: "STD 4" },
      { label: "Day or boarding", from: "Day", to: "Boarding" },
    ],
    unknownCount: 1,
    details: {
      action: "update",
      table: "leads",
      rowId: "7c1e4b2a-93d0-4f1e-a8c5-2b6d1e0f9a41",
      fields: [
        { field: "class_name", from: "STD 3", to: "STD 4" },
        { field: "extra_col", from: "a", to: "b" },
      ],
    },
    link: { label: "Open the application", href: "/staff/applicants/7c1e4b2a-93d0-4f1e-a8c5-2b6d1e0f9a41/history" },
  },
]

describe("AuditTable", () => {
  it("renders four columns and opens the side sheet with plain words and always-visible Details on row click and Enter", async () => {
    const user = userEvent.setup()
    render(<AuditTable entries={SAMPLE} />)

    const table = screen.getByRole("table", { name: "Audit entries" })
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent)
    expect(headers).toEqual(["Date", "Actor", "Event", "Record"])

    const row = within(table).getAllByRole("row")[1]
    expect(row).toHaveTextContent("22 Nov 2026, 10:02")
    expect(row).toHaveTextContent("Zawadi Mrema")
    expect(row).toHaveTextContent("Changed the application")
    expect(row).toHaveTextContent("Amina Juma")
    expect(row).toHaveTextContent("ADMSN-40719")

    await user.click(row)

    const sheet = await screen.findByRole("dialog", { name: "Changed the application" })
    expect(sheet).toHaveTextContent("Zawadi Mrema · 22 Nov 2026, 10:02")
    expect(sheet).toHaveTextContent("Applicants")
    expect(sheet).toHaveTextContent("Record")
    expect(sheet).toHaveTextContent("Applicant")
    expect(sheet).toHaveTextContent("What changed")
    expect(sheet).toHaveTextContent("STD 3")
    expect(sheet).toHaveTextContent("STD 4")
    expect(sheet).toHaveTextContent("1 more change, listed under Details.")
    expect(sheet).toHaveTextContent("Details")
    expect(sheet).toHaveTextContent("class_name")
    expect(sheet).toHaveTextContent("extra_col")
    expect(within(sheet).queryByRole("button", { name: /Show details/i })).toBeNull()
    expect(within(sheet).getByRole("link", { name: "Open the application" })).toHaveAttribute(
      "href",
      "/staff/applicants/7c1e4b2a-93d0-4f1e-a8c5-2b6d1e0f9a41/history",
    )

    await user.click(within(sheet).getByRole("button", { name: "Close" }))
    expect(screen.queryByRole("dialog")).toBeNull()

    // Pressing Enter on the row opens the sheet again.
    row.focus()
    await user.keyboard("{Enter}")
    expect(await screen.findByRole("dialog", { name: "Changed the application" })).toBeVisible()
  })
})

describe("AuditFiltersForm", () => {
  beforeEach(() => {
    push.mockReset()
  })

  it("renders all five filters, Apply, and Clear filters which empties every filter and navigates to /staff/audit", async () => {
    const user = userEvent.setup()
    render(
      <AuditFiltersForm
        filters={{ from: "2026-11-01", to: "2026-11-22", actor: "system", area: "payment", record: "ADMSN-40719" }}
        actors={[{ id: "s1", name: "Zawadi Mrema" }]}
      />,
    )

    expect(screen.getByLabelText("From")).toHaveValue("01/11/2026")
    expect(screen.getByLabelText("To")).toHaveValue("22/11/2026")
    expect(screen.getByRole("combobox", { name: "Who" })).toHaveTextContent("System")
    expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Payments")
    expect(screen.getByLabelText("Record")).toHaveValue("ADMSN-40719")
    expect(screen.getByRole("button", { name: "Apply" })).toBeVisible()

    const clear = screen.getByRole("button", { name: "Clear filters" })
    expect(clear).toHaveAttribute("title", "Clear filters")
    await user.click(clear)

    expect(screen.getByLabelText("From")).toHaveValue("")
    expect(screen.getByLabelText("To")).toHaveValue("")
    expect(screen.getByRole("combobox", { name: "Who" })).toHaveTextContent("Anyone")
    expect(screen.getByRole("combobox", { name: "Area" })).toHaveTextContent("Everything")
    expect(screen.getByLabelText("Record")).toHaveValue("")
    expect(push).toHaveBeenCalledWith("/staff/audit")
  })
})
