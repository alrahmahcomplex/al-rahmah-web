import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { ColumnHeader, FilterChoices, Highlight, ListFoot, PageHeader, SearchField, Select, Table } from "@/components/kit"

// The list tools (Interviews revamp, prototype 1MpUKuX27V6pc1CS1z1URz v5):
// what each part does with what it is given. The browser test on Interviews
// covers the popovers and the keyboard; screenshots in the PR cover the look.

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

function Search() {
  const [q, setQ] = useState("")
  return <SearchField value={q} onChange={setQ} label="Search the interviews" placeholder="Search a name" />
}

describe("the search field", () => {
  it("shows Clear only once something is typed, and Clear empties it and keeps the cursor there", () => {
    render(<Search />)
    const box = screen.getByRole("searchbox", { name: "Search the interviews" })
    expect(screen.queryByRole("button", { name: "Clear the search" })).toBeNull()
    fireEvent.change(box, { target: { value: "ami" } })
    expect(box).toHaveValue("ami")
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }))
    expect(box).toHaveValue("")
    expect(box).toHaveFocus()
  })

  it("clears on Escape", () => {
    render(<Search />)
    const box = screen.getByRole("searchbox", { name: "Search the interviews" })
    fireEvent.change(box, { target: { value: "juma" } })
    fireEvent.keyDown(box, { key: "Escape" })
    expect(box).toHaveValue("")
  })
})

describe("the search match", () => {
  it("marks only the stretches given", () => {
    const { container } = render(<Highlight text="Amina Juma" marks={[[0, 3]]} />)
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Ami"])
    expect(container.textContent).toBe("Amina Juma")
  })
})

describe("the filter choices", () => {
  it("keeps one value in a one-choice group, All clearing it", () => {
    const onChange = vi.fn()
    render(<FilterChoices label="Result" options={[{ value: "Passed", label: "Passed", count: 3 }]} value="Passed" onChange={onChange} />)
    expect(screen.getByRole("button", { name: /Passed/ })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: /All/ }))
    expect(onChange).toHaveBeenCalledWith("")
  })

  it("adds and removes values in a many-choice group, as rows or chips", () => {
    function Classes({ look }: { look: "rows" | "chips" }) {
      const [value, setValue] = useState<string[]>(["KG 1"])
      return (
        <FilterChoices
          label="Class"
          many
          look={look}
          allLabel="All classes"
          options={[
            { value: "KG 1", label: "KG 1" },
            { value: "KG 2", label: "KG 2" },
          ]}
          value={value}
          onChange={setValue}
        />
      )
    }
    for (const look of ["rows", "chips"] as const) {
      const { unmount } = render(<Classes look={look} />)
      const kg1 = screen.getByRole("button", { name: "KG 1" })
      const kg2 = screen.getByRole("button", { name: "KG 2" })
      fireEvent.click(kg2)
      expect(kg1).toHaveAttribute("aria-pressed", "true")
      expect(kg2).toHaveAttribute("aria-pressed", "true")
      fireEvent.click(kg1)
      expect(kg1).toHaveAttribute("aria-pressed", "false")
      fireEvent.click(screen.getByRole("button", { name: "All classes" }))
      expect(kg2).toHaveAttribute("aria-pressed", "false")
      expect(screen.getByRole("button", { name: "All classes" })).toHaveAttribute("aria-pressed", "true")
      unmount()
    }
  })
})

describe("the sortable column heading", () => {
  it("says what the next press does, and the column carries aria-sort", () => {
    const onSort = vi.fn()
    const { rerender } = render(
      <Table label="List" rowKey={(r: { id: string }) => r.id} rows={[{ id: "a" }]} columns={[{ header: <ColumnHeader label="Score" sort={null} onSort={onSort} />, cell: () => "1" }]} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Sort by Score, lowest first" }))
    expect(onSort).toHaveBeenCalledOnce()
    expect(screen.getByRole("columnheader")).not.toHaveAttribute("aria-sort")
    rerender(
      <Table
        label="List"
        rowKey={(r: { id: string }) => r.id}
        rows={[{ id: "a" }]}
        columns={[{ header: <ColumnHeader label="Score" sort="asc" onSort={onSort} />, ariaSort: "ascending", cell: () => "1" }]}
      />,
    )
    expect(screen.getByRole("button", { name: "Sort by Score, highest first" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort", "ascending")
  })

  it("opens the column's filter from its name, and says when the filter is on", async () => {
    render(<ColumnHeader label="Class" filterOn filter={() => <p>The classes</p>} />)
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Filter by Class, on" })))
    expect(await screen.findByText("The classes")).toBeInTheDocument()
  })

  it("has no sort button for a column that does not sort", () => {
    render(<ColumnHeader label="Student" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("the page title's count and trail", () => {
  it("puts the pages before the title as links, and names the count", () => {
    render(<PageHeader title="Amina Juma" count={142} countLabel="142 interviews for 2027" trail={[{ label: "Interviews", href: "/staff/interviews?year=2027" }]} />)
    expect(screen.getByRole("link", { name: "Interviews" })).toHaveAttribute("href", "/staff/interviews?year=2027")
    expect(screen.getByRole("heading", { level: 1, name: "Amina Juma" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "142 interviews for 2027" })).toHaveTextContent("142")
  })
})

describe("the list foot and the Select's name inside", () => {
  it("shows the count, and page numbers only for more than one page", () => {
    const { rerender } = render(<ListFoot summary="Showing 1–3 of 3 interviews" pagination={{ label: "Pages", page: 1, pageCount: 1, onPage: () => {}, previousLabel: "Previous", nextLabel: "Next" }} />)
    expect(screen.getByText("Showing 1–3 of 3 interviews")).toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Pages" })).toBeNull()
    rerender(<ListFoot summary="Showing 1–50 of 142 interviews" pagination={{ label: "Pages", page: 1, pageCount: 3, onPage: () => {}, previousLabel: "Previous", nextLabel: "Next" }} />)
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeInTheDocument()
  })

  it("shows its prefix in the pill beside the chosen value", () => {
    render(<Select aria-label="Enrollment year" prefix="Enrollment year" value="2027" options={[{ value: "2027", label: "2027", hint: "· 142 interviews" }]} />)
    const pill = screen.getByRole("combobox", { name: "Enrollment year" })
    expect(pill).toHaveTextContent("Enrollment year2027")
    expect(pill).not.toHaveTextContent("142 interviews")
  })
})
