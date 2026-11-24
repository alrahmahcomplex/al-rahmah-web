import { act, fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  Button,
  ButtonLink,
  Card,
  ChipButtons,
  CodeChip,
  EmptyState,
  Field,
  FieldError,
  FilterMenu,
  FilterPills,
  FinishedState,
  KeyValueList,
  ListRow,
  LoadingState,
  MenuProfileRow,
  Note,
  PAGE_ACTIONS_ID,
  PageActions,
  PageHeader,
  pageTitle,
  RoundButton,
  Section,
  SkeletonBlock,
  StatusChip,
  StepTrack,
  Table,
  Tag,
  TaskCard,
  TextLink,
  TopBarHomeOrBack,
} from "@/components/kit"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe("ButtonLink", () => {
  it("is a link named by its label, drawn as a button", () => {
    render(
      <ButtonLink href="/staff/applicants" size="wide" chevron>
        Open Applicants
      </ButtonLink>,
    )
    const link = screen.getByRole("link", { name: "Open Applicants" })
    expect(link).toHaveAttribute("href", "/staff/applicants")
    expect(link).toHaveClass("kit-btn", "kit-go", "kit-wide")
  })
})

describe("Button", () => {
  it("is named by its label and calls onClick", () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Continue</Button>)
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("draws Go, Ghost, Small and Wide", () => {
    render(
      <>
        <Button>Go</Button>
        <Button variant="ghost" size="small">
          Ghost small
        </Button>
        <Button size="wide" chevron icon="plus">
          Wide
        </Button>
      </>,
    )
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("kit-btn", "kit-go")
    expect(screen.getByRole("button", { name: "Ghost small" })).toHaveClass("kit-ghost", "kit-sm")
    const wide = screen.getByRole("button", { name: "Wide" })
    expect(wide).toHaveClass("kit-wide")
    expect(wide.querySelectorAll("svg")).toHaveLength(2)
  })

  it("draws Bad and Warn, the outlined red and dark orange steps (v38)", () => {
    render(
      <>
        <Button variant="bad" size="wide">
          Yes, clear the form
        </Button>
        <Button variant="warn" size="small">
          Withdraw request
        </Button>
      </>,
    )
    const bad = screen.getByRole("button", { name: "Yes, clear the form" })
    expect(bad).toHaveClass("kit-btn", "kit-bad", "kit-wide")
    expect(bad).not.toHaveClass("kit-go")
    expect(screen.getByRole("button", { name: "Withdraw request" })).toHaveClass("kit-btn", "kit-warn", "kit-sm")
  })

  it("while pending stays focusable, is busy, drops the chevron and refuses clicks and submits", () => {
    const onClick = vi.fn()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" pending chevron onClick={onClick}>
          Finding the family…
        </Button>
      </form>,
    )
    const button = screen.getByRole("button", { name: "Finding the family…" })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(button).toHaveAttribute("aria-disabled", "true")
    expect(button.querySelectorAll("svg")).toHaveLength(0)
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("keeps the native disabled state", () => {
    render(<Button disabled>Find</Button>)
    expect(screen.getByRole("button", { name: "Find" })).toBeDisabled()
  })

  it("refuses clicks when aria-disabled", () => {
    const onClick = vi.fn()
    render(
      <Button aria-disabled onClick={onClick}>
        Find
      </Button>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Find" }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe("RoundButton and TextLink", () => {
  it("names a round button by its label, hides the icon and hosts its active state", () => {
    render(<RoundButton icon="bell" label="New requests" size={40} />)
    const button = screen.getByRole("button", { name: "New requests" })
    expect(button).toHaveAttribute("data-size", "40")
    expect(button).toHaveAttribute("data-icon-host")
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("draws a text link as a button named by its text", () => {
    render(<TextLink>Edit</TextLink>)
    expect(screen.getByRole("button", { name: "Edit" })).toHaveClass("kit-link")
  })
})

describe("Field", () => {
  it("is named by its aria-label and draws the sizes", () => {
    render(
      <>
        <Field aria-label="Full" />
        <Field aria-label="Compact" size="compact" />
        <Field aria-label="Search" size="search" icon="search" />
      </>,
    )
    expect(screen.getByRole("textbox", { name: "Full" })).not.toHaveAttribute("data-size")
    expect(screen.getByRole("textbox", { name: "Compact" })).toHaveAttribute("data-size", "compact")
    const search = screen.getByRole("textbox", { name: "Search" })
    expect(search).toHaveAttribute("data-size", "search")
    expect(search).toHaveAttribute("data-align", "start")
    expect(search.previousElementSibling?.tagName).toBe("svg")
  })

  it("marks an invalid field and links the folding error line, read out as an alert", () => {
    const { rerender } = render(
      <>
        <Field aria-label="Name" aria-describedby="err" />
        <FieldError id="err" />
      </>,
    )
    expect(screen.getByRole("textbox", { name: "Name" })).not.toHaveAttribute("aria-invalid")
    expect(screen.getByRole("alert")).toBeEmptyDOMElement()
    expect(screen.getByRole("alert").closest(".kit-err")).not.toHaveAttribute("data-open")

    rerender(
      <>
        <Field aria-label="Name" aria-describedby="err" invalid />
        <FieldError id="err" message="Type the full name, at least two names." />
      </>,
    )
    const field = screen.getByRole("textbox", { name: "Name" })
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(field).toHaveAccessibleDescription("Type the full name, at least two names.")
    expect(screen.getByRole("alert").closest(".kit-err")).toHaveAttribute("data-open")
  })
})

describe("ChipButtons and FilterPills", () => {
  it("presses one chip at a time in a named group", () => {
    const onChange = vi.fn()
    render(<ChipButtons label="What kind of payment is it?" options={[{ value: "a", label: "Initial deposit" }, { value: "b", label: "Full payment" }]} value="a" onChange={onChange} />)
    const group = screen.getByRole("group", { name: "What kind of payment is it?" })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Initial deposit" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Full payment" })).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(screen.getByRole("button", { name: "Full payment" }))
    expect(onChange).toHaveBeenCalledWith("b")
  })

  it("presses the current filter pill", () => {
    const onChange = vi.fn()
    render(<FilterPills label="Filter by status" options={["All", "Applied"].map((v) => ({ value: v, label: v }))} value="All" onChange={onChange} />)
    expect(screen.getByRole("group", { name: "Filter by status" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Applied" })).toHaveClass("kit-fpill")
    fireEvent.click(screen.getByRole("button", { name: "Applied" }))
    expect(onChange).toHaveBeenCalledWith("Applied")
  })

  it("draws href options as links in a named nav, the current one marked, with children after them (#419)", () => {
    render(
      <FilterPills
        label="Agent status"
        options={[
          { label: "Pending", href: "/staff/agents" },
          { label: "Retired (3)", href: "/staff/agents?status=retired" },
        ]}
        current="/staff/agents?status=retired"
      >
        <span>Clear search</span>
      </FilterPills>,
    )
    const nav = screen.getByRole("navigation", { name: "Agent status" })
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(Array.from(nav.children).map((child) => [child.tagName, child.textContent])).toEqual([
      ["A", "Pending"],
      ["A", "Retired (3)"],
      ["SPAN", "Clear search"],
    ])
    expect(screen.getByRole("link", { name: "Retired (3)" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Retired (3)" })).toHaveAttribute("href", "/staff/agents?status=retired")
    expect(screen.getByRole("link", { name: "Pending" })).not.toHaveAttribute("aria-current")
  })

  it("marks no link when no filter is on screen", () => {
    render(<FilterPills label="Agent status" options={[{ label: "Pending", href: "/staff/agents" }]} current={null} />)
    expect(screen.getByRole("navigation", { name: "Agent status" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Pending" })).not.toHaveAttribute("aria-current")
  })
})

describe("chips", () => {
  it.each([
    ["Applied", undefined],
    ["Visited", "visited"],
    ["Interviewed", "interviewed"],
    ["Enrolled", "ok"],
    ["Declined", "bad"],
    ["Inactive", "inactive"],
    ["Archived", "archived"],
  ] as const)("shows %s in its own tint", (status, tone) => {
    render(<StatusChip status={status} />)
    const chip = screen.getByText(status)
    expect(chip).toHaveClass("kit-chip")
    if (tone) expect(chip).toHaveAttribute("data-tone", tone)
    else expect(chip).not.toHaveAttribute("data-tone")
  })

  it.each(["wait", "ok", "bad", "line"] as const)("draws a %s tag", (tone) => {
    render(<Tag tone={tone}>Tag</Tag>)
    expect(screen.getByText("Tag")).toHaveAttribute("data-tone", tone)
  })
})

describe("cards and page header", () => {
  it("names a card by its title", () => {
    render(
      <Card title="Needs you today" titleId="needs" caption="Tap a row">
        <p>Body</p>
      </Card>,
    )
    expect(screen.getByRole("region", { name: "Needs you today" })).toHaveClass("kit-card")
    expect(screen.getByRole("heading", { level: 2, name: "Needs you today" })).toBeInTheDocument()
    expect(screen.getByText("Tap a row")).toHaveClass("kit-card-cap")
  })

  it("lifts the task card", () => {
    render(<TaskCard aria-label="Task">x</TaskCard>)
    expect(screen.getByRole("region", { name: "Task" })).toHaveClass("kit-task")
  })

  it("gives the page one h1, the subtitle, the actions slot, and the tab title", () => {
    render(<PageHeader title="Applicants" subtitle="Every student, from Applied to Enrolled." actions={<Button size="small">Register students</Button>} />)
    expect(screen.getByRole("heading", { level: 1, name: "Applicants" })).toBeInTheDocument()
    const slot = document.getElementById(PAGE_ACTIONS_ID)!
    expect(slot).toContainElement(screen.getByRole("button", { name: "Register students" }))
    expect(pageTitle("Applicants")).toBe("Applicants · Al-Rahmah Complex")
  })

  it("lets a client part put an action into the slot", () => {
    render(
      <>
        <PageHeader title="Register students" />
        <PageActions>
          <Button variant="ghost" size="small">
            Cancel
          </Button>
        </PageActions>
      </>,
    )
    expect(document.getElementById(PAGE_ACTIONS_ID)).toContainElement(screen.getByRole("button", { name: "Cancel" }))
  })

  it("shows an example header as an h2 without the slot", () => {
    render(<PageHeader level={2} title="Applicants" />)
    expect(screen.getByRole("heading", { level: 2, name: "Applicants" })).toBeInTheDocument()
    expect(document.getElementById(PAGE_ACTIONS_ID)).toBeNull()
  })
})

describe("ListRow", () => {
  it("is a link with a chevron when it opens a page", () => {
    render(<ListRow icon="interviews" title="3 interviews today" caption="The first is at 10:00" href="/staff/interviews" />)
    const link = screen.getByRole("link", { name: /3 interviews today/ })
    expect(link).toHaveAttribute("href", "/staff/interviews")
    expect(link.querySelector(".kit-row-disc svg")).toHaveAttribute("data-featured")
    expect(link.querySelector(".kit-row-chev")).not.toBeNull()
  })

  it("is a button when it does something, marked when current", () => {
    const onClick = vi.fn()
    render(<ListRow title="Baraka Mfano" onClick={onClick} current />)
    const row = screen.getByRole("button", { name: "Baraka Mfano" })
    expect(row).toHaveAttribute("aria-current", "true")
    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("is a plain row otherwise", () => {
    render(<ListRow title="Plain" trailing={<Tag tone="wait">Waiting</Tag>} />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
  })
})

describe("Table", () => {
  const rows = [
    { name: "Salma", fee: "TZS 1,800,000" },
    { name: "Baraka", fee: "TZS 2,600,000" },
  ]
  const columns = [
    { header: "Student", cell: (r: (typeof rows)[number]) => r.name },
    { header: "Fee", cell: (r: (typeof rows)[number]) => r.fee, align: "end" as const },
  ]

  it("is named, right-aligns money and adds a total row", () => {
    render(<Table label="Fees" rows={rows} rowKey={(r) => r.name} columns={columns} total={["Total", "TZS 4,400,000"]} />)
    const table = screen.getByRole("table", { name: "Fees" })
    expect(screen.getByRole("columnheader", { name: "Fee" })).toHaveAttribute("data-align", "end")
    expect(screen.getByRole("cell", { name: "TZS 1,800,000" })).toHaveAttribute("data-align", "end")
    expect(table.querySelector("tfoot")).toHaveTextContent("TZS 4,400,000")
    expect(screen.getAllByRole("row")[1]).not.toHaveAttribute("tabindex")
  })

  it("opens a row on click and on Enter, and names it", () => {
    const onOpen = vi.fn()
    render(<Table label="Applicants" rows={rows} rowKey={(r) => r.name} columns={columns} onOpen={onOpen} rowLabel={(r) => r.name} />)
    const row = screen.getByRole("row", { name: "Baraka" })
    expect(row).toHaveAttribute("tabindex", "0")
    fireEvent.click(row)
    fireEvent.keyDown(screen.getByRole("row", { name: "Salma" }), { key: "Enter" })
    fireEvent.keyDown(row, { key: " " })
    expect(onOpen.mock.calls.map(([r]) => r.name)).toEqual(["Baraka", "Salma"])
  })

  it("draws the cell that names its row as a row header", () => {
    render(<Table label="Agents" rows={rows} rowKey={(r) => r.name} columns={[{ ...columns[0], rowHeader: true }, columns[1]]} />)
    const header = screen.getByRole("rowheader", { name: "Salma" })
    expect(header.tagName).toBe("TH")
    expect(header).toHaveAttribute("scope", "row")
    expect(screen.getByRole("cell", { name: "TZS 1,800,000" }).tagName).toBe("TD")
    expect(screen.queryByRole("cell", { name: "Salma" })).toBeNull()
  })
})

describe("details", () => {
  it("lists keys and values with a reason line", () => {
    render(<KeyValueList items={[{ key: "Fee this year", value: "TZS 1,800,000", reason: "Full fee", numeric: true }]} />)
    const term = screen.getByRole("term")
    expect(term).toHaveTextContent("Fee this year")
    const value = screen.getByRole("definition")
    expect(value).toHaveTextContent("TZS 1,800,000Full fee")
    expect(value).toHaveClass("kit-num")
  })

  it("heads a section with an h3", () => {
    render(<Section title="Student">x</Section>)
    expect(screen.getByRole("heading", { level: 3, name: "Student" })).toBeInTheDocument()
  })

  it.each([
    ["info", undefined],
    ["good", "good"],
    ["wait", "wait"],
    ["bad", "bad"],
  ] as const)("draws a %s note with an icon and its role", (tone, attr) => {
    render(
      <Note tone={tone} role="status">
        Note text
      </Note>,
    )
    const note = screen.getByRole("status")
    expect(note).toHaveTextContent("Note text")
    expect(note.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    if (attr) expect(note).toHaveAttribute("data-tone", attr)
    else expect(note).not.toHaveAttribute("data-tone")
  })
})

describe("states", () => {
  it("shows an empty state with its line illustration hidden", () => {
    const { container, rerender } = render(
      <EmptyState title="No applicant matches" hint="Clear the filter to see everyone." action={<Button size="small">Clear</Button>} />,
    )
    expect(screen.getByText("No applicant matches")).toBeInTheDocument()
    expect(screen.queryByRole("img")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    const picture = container.querySelector("svg[data-illustration]")!
    expect(picture).toHaveAttribute("data-illustration", "search")
    expect(picture).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument()
    rerender(<EmptyState illustration="oops" title="Something went wrong" />)
    expect(container.querySelector("svg[data-illustration]")).toHaveAttribute("data-illustration", "oops")
  })

  it("announces loading over its moving picture", () => {
    const { container, rerender } = render(<LoadingState label="Finding the family…" />)
    expect(screen.getByRole("status")).toHaveTextContent("Finding the family…")
    expect(container.querySelector("svg[data-illustration]")).toHaveAttribute("data-illustration", "finding")
    rerender(<LoadingState illustration="sending" label="Sending invites…" />)
    expect(container.querySelector("svg[data-illustration]")).toHaveAttribute("data-illustration", "sending")
  })

  it("shows the finished task with the finish mark and its results", () => {
    const { container } = render(
      <FinishedState title="2 students registered" hint="Give the family these Admission Numbers." results={[{ label: "Bakari", value: "DMSN-90013" }]}>
        <Button size="wide">Open Applicants</Button>
      </FinishedState>,
    )
    // The live Admission form's mark: a circle and a tick, hidden from screen readers; no illustration.
    const mark = container.querySelector(".kit-mark")!
    expect(mark).toHaveAttribute("aria-hidden", "true")
    expect(mark.querySelector("circle")).toHaveAttribute("r", "40")
    expect(mark.querySelector(".kit-mark-tick")).toHaveAttribute("d", "M26 43l11 11 21-23")
    expect(container.querySelector("[data-illustration]")).toBeNull()
    const title = screen.getByRole("heading", { level: 2, name: "2 students registered" })
    expect(title).toHaveAttribute("tabindex", "-1")
    expect(screen.getByRole("listitem")).toHaveTextContent("BakariDMSN-90013")
    expect(screen.getByRole("button", { name: "Open Applicants" })).toBeInTheDocument()
  })

  it("draws still skeleton blocks hidden from screen readers", () => {
    const { container } = render(<SkeletonBlock width={140} height={36} shape="pill" />)
    const bone = container.firstElementChild!
    expect(bone).toHaveAttribute("aria-hidden", "true")
    expect(bone).toHaveAttribute("data-shape", "pill")
    expect(bone).toHaveStyle({ width: "140px", height: "36px" })
  })
})

// #374 and #375: two kit fixes that jsdom has no layout to show, read from the rule and the DOM.
describe("table scroll box and sheet body", () => {
  it("keeps the table's scroll box positioned, so an sr-only label in a cell stays inside it", async () => {
    const { readFileSync } = await import("node:fs")
    const css = readFileSync(`${process.cwd()}/components/kit/kit.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    const rule = /(^|\})\s*\.kit-tw\s*\{([^}]*)\}/.exec(css)
    expect(rule?.[2]).toMatch(/position:\s*relative/)
  })

  it.each([
    [false, 200, 200],
    [true, 201, 200],
    [true, 900, 200],
  ])("puts the sheet body in the tab order only while it scrolls (scrolls: %s)", async (scrolls, scrollHeight, clientHeight) => {
    const { Sheet } = await import("@/components/kit")
    const height = (value: number) => ({ configurable: true, get: () => value })
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
    const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", height(scrollHeight))
    Object.defineProperty(HTMLElement.prototype, "clientHeight", height(clientHeight))
    try {
      render(
        <Sheet open onOpenChange={() => {}} title="Retire the role" hint="Its staff keep their sign-in." closeLabel="Close">
          <p>Details</p>
        </Sheet>,
      )
      const body = document.querySelector(".kit-sheet-body")!
      if (scrolls) expect(body).toHaveAttribute("tabindex", "0")
      else expect(body).not.toHaveAttribute("tabindex")
    } finally {
      if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scroll)
      if (client) Object.defineProperty(HTMLElement.prototype, "clientHeight", client)
    }
  })

  it("follows the body as it grows, shrinks and gains or loses content while open", async () => {
    const { Sheet } = await import("@/components/kit")
    // A stand-in ResizeObserver whose callback the test fires, and heights the test sets.
    const observers: (() => void)[] = []
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    let scrollHeight = 200
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
    const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => scrollHeight })
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 200 })
    const resized = () => act(() => observers.forEach((callback) => callback()))
    try {
      // Rows straight in the body, then rows inside a wrapper whose own box never changes.
      const sheet = (rows: number, nested = 0) => (
        <Sheet open onOpenChange={() => {}} title="Retire the role" closeLabel="Close">
          {Array.from({ length: rows }, (_, i) => (
            <p key={i}>Row {i}</p>
          ))}
          <div>
            {Array.from({ length: nested }, (_, i) => (
              <p key={i}>Nested {i}</p>
            ))}
          </div>
        </Sheet>
      )
      const { rerender } = render(sheet(1))
      const body = document.querySelector(".kit-sheet-body")!
      expect(body).not.toHaveAttribute("tabindex")

      // The body grows past its box: the keyboard can now reach it to scroll.
      scrollHeight = 900
      resized()
      expect(body).toHaveAttribute("tabindex", "0")
      // It shrinks back: it leaves the tab order.
      scrollHeight = 200
      resized()
      expect(body).not.toHaveAttribute("tabindex")

      // Content added while open is seen through the child list, without a resize.
      scrollHeight = 900
      await act(async () => rerender(sheet(8)))
      expect(body).toHaveAttribute("tabindex", "0")
      scrollHeight = 200
      await act(async () => rerender(sheet(1)))
      expect(body).not.toHaveAttribute("tabindex")

      // Content loading inside a wrapper, deeper than the body's own children, is seen too.
      scrollHeight = 900
      await act(async () => rerender(sheet(1, 8)))
      expect(body).toHaveAttribute("tabindex", "0")
      scrollHeight = 200
      await act(async () => rerender(sheet(1, 0)))
      expect(body).not.toHaveAttribute("tabindex")
    } finally {
      if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scroll)
      if (client) Object.defineProperty(HTMLElement.prototype, "clientHeight", client)
      vi.unstubAllGlobals()
    }
  })
})

describe("agents app kit parts (#539)", () => {
  it("opens FilterMenu with radio items, counts, disabled 0-count items, and calls onSelect", () => {
    const onSelect = vi.fn()
    render(
      <FilterMenu
        label="Filter"
        currentLabel="Visited"
        value="Visited"
        active
        options={[
          { value: "all", label: "All", count: 5 },
          { value: "Visited", label: "Visited", count: 2 },
          { value: "Enrolled", label: "Enrolled", count: 0, disabled: true },
        ]}
        onSelect={onSelect}
      />,
    )
    const trigger = screen.getByRole("button", { name: "Filter: Visited" })
    expect(trigger).toHaveAttribute("data-on", "")
    fireEvent.click(trigger)
    expect(screen.getByRole("menu", { name: "Filter" })).toBeInTheDocument()
    expect(screen.getByRole("menuitemradio", { name: /Visited/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("menuitemradio", { name: /Enrolled/ })).toBeDisabled()
    fireEvent.click(screen.getByRole("menuitemradio", { name: /All/ }))
    expect(onSelect).toHaveBeenCalledWith("all")
  })

  it("renders CodeChip with code and copy button", () => {
    render(
      <CodeChip
        code="ABC-123"
        prefix="Your code"
        copyValue="https://alrahmahcomplex.or.tz/apply?ref=ABC-123"
        copyLabel="Copy link"
        copiedMessage="Link copied"
        copyFailedMessage="Could not copy"
      />,
    )
    expect(screen.getByText("ABC-123")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument()
  })

  it("renders StepTrack marking the current step", () => {
    render(
      <StepTrack
        label="Step now"
        steps={[
          { label: "Applied", state: "done" },
          { label: "Visited", state: "current" },
          { label: "Enrolled", state: "upcoming" },
        ]}
      />,
    )
    const items = screen.getAllByRole("listitem")
    expect(items[0]).toHaveAttribute("data-state", "done")
    expect(items[1]).toHaveAttribute("data-state", "current")
    expect(items[1]).toHaveAttribute("aria-current", "step")
    expect(items[2]).toHaveAttribute("data-state", "upcoming")
  })

  it("renders MenuProfileRow and fires onClick", () => {
    const onClick = vi.fn()
    render(
      <div role="menu">
        <MenuProfileRow initials="AK" name="Amina Kassim" subtitle="ABC-123" onClick={onClick} />
      </div>,
    )
    fireEvent.click(screen.getByRole("menuitem", { name: /Amina Kassim/ }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("swaps between logo link on home and back button elsewhere in TopBarHomeOrBack", () => {
    const onBack = vi.fn()
    const { rerender } = render(<TopBarHomeOrBack onHome homeHref="/home" homeLabel="Home" backLabel="Back" onBack={onBack} />)
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home")
    rerender(<TopBarHomeOrBack onHome={false} homeHref="/home" homeLabel="Home" backLabel="Back" onBack={onBack} />)
    fireEvent.click(screen.getByRole("button", { name: "Back" }))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
