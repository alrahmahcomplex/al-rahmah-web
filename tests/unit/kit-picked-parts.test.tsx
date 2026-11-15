import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { CodeBox, FatherNameBoxes, formatCode, FullNameBox, hasTwoNames, PersonNameBoxes, StudentNameBoxes, typeInNameBox, type PersonName } from "@/components/guided-form"
import { Accordion, AvatarGroup, Pagination, pageWindow, RoundButton, StepSlider, Tabs, TabSwitch, Tooltip } from "@/components/kit"

// The parts the owner picked on prototype v38 (#402): what the name boxes and
// the code box do to typing, and how the tabs, the pages and the accordion
// answer the keyboard. Screenshots in the PR cover the look.

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; scroll?: boolean }) => {
    const attributes: Record<string, unknown> = { ...props }
    delete attributes.scroll
    return (
      <a href={href} {...attributes}>
        {children}
      </a>
    )
  },
}))

const LABELS = { first: "First name", middle: "Middle name", last: "Last name" }
const posted = (form: HTMLFormElement) => Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]))
const box = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement

describe("typeInNameBox", () => {
  const keys = ["a", "b", "c"] as const
  const none = { a: "", b: "", c: "" }

  it("puts the box in capitals and stays", () => {
    expect(typeInNameBox(keys, none, 0, "amina")).toEqual({ values: { ...none, a: "AMINA" }, focus: null })
  })

  it("ends a box at a space and moves on", () => {
    expect(typeInNameBox(keys, none, 0, "amina ")).toEqual({ values: { ...none, a: "AMINA" }, focus: 1 })
  })

  it("spreads a pasted full name across the boxes, the last keeping its spaces", () => {
    expect(typeInNameBox(keys, none, 0, "Amina Juma Bin Salim")).toEqual({ values: { a: "AMINA", b: "JUMA", c: "BIN SALIM" }, focus: 2 })
  })

  it("puts what follows a space in front of what the next box holds", () => {
    expect(typeInNameBox(keys, { a: "", b: "SALIM", c: "" }, 0, "AMINA JUMA")).toEqual({ values: { a: "AMINA", b: "JUMA", c: "SALIM" }, focus: 2 })
  })

  it("drops a space at the start of a box", () => {
    expect(typeInNameBox(keys, none, 1, " ")).toEqual({ values: none, focus: null })
  })
})

describe("the single-box rules", () => {
  it("puts the hyphen between one to three letters and the number", () => {
    expect(formatCode("aan132")).toBe("AAN-132")
    expect(formatCode("AAN")).toBe("AAN")
    expect(formatCode("aan1")).toBe("AAN-1")
    expect(formatCode("aa n-1 3 2 9")).toBe("AAN-1329")
    expect(formatCode("a!a")).toBe("AA")
    // Two-name agents and numbers past 999 (#404).
    expect(formatCode("jd123")).toBe("JD-123")
    expect(formatCode("abc1234")).toBe("ABC-1234")
    expect(formatCode("ABC-1000")).toBe("ABC-1000")
  })

  it("keeps any other code as typed, Promo codes included, up to 20 characters", () => {
    for (const promo of ["MWAKASEGE", "KARIBU2026", "SAVE10", "2026", "RAMADHAN25", "ABCD12"]) expect(formatCode(promo)).toBe(promo)
    expect(formatCode("karibu 2026")).toBe("KARIBU2026")
    expect(formatCode("mama.salma")).toBe("MAMA.SALMA")
    expect(formatCode("A".repeat(25))).toBe("A".repeat(20))
  })

  it("asks for at least two names", () => {
    expect(hasTwoNames("  juma  ")).toBe(false)
    expect(hasTwoNames("juma  khamis")).toBe(true)
  })
})

describe("PersonNameBoxes", () => {
  it("types in capitals, moves on at a space, and posts firstName, middleName and lastName", async () => {
    const user = userEvent.setup()
    render(
      <form data-testid="form">
        <PersonNameBoxes labels={LABELS} />
      </form>,
    )
    await user.click(box("First name"))
    await user.keyboard("amina juma salim mrisho")
    expect(box("First name")).toHaveValue("AMINA")
    expect(box("Middle name")).toHaveValue("JUMA")
    expect(box("Last name")).toHaveValue("SALIM MRISHO")
    expect(box("Last name")).toHaveFocus()
    expect(posted(screen.getByTestId("form"))).toEqual({ firstName: "AMINA", middleName: "JUMA", lastName: "SALIM MRISHO" })
  })

  it("spreads a pasted name and goes back on Backspace in an empty box", async () => {
    const user = userEvent.setup()
    render(<PersonNameBoxes labels={LABELS} />)
    await user.click(box("First name"))
    await user.paste("Asha Saidi Omari")
    expect([box("First name").value, box("Middle name").value, box("Last name").value]).toEqual(["ASHA", "SAIDI", "OMARI"])
    expect(box("Last name")).toHaveFocus()

    await user.clear(box("Last name"))
    await user.keyboard("{Backspace}")
    expect(box("Middle name")).toHaveFocus()
    expect(box("Middle name").selectionStart).toBe(5)
    // Backspace in a box that holds text deletes as usual.
    await user.keyboard("{Backspace}")
    expect(box("Middle name")).toHaveValue("SAID")
  })

  it("Enter moves to the next box instead of sending the form", async () => {
    const user = userEvent.setup()
    const sent = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={sent}>
        <PersonNameBoxes labels={LABELS} />
      </form>,
    )
    await user.click(box("First name"))
    await user.keyboard("ASHA{Enter}")
    expect(box("Middle name")).toHaveFocus()
    expect(sent).not.toHaveBeenCalled()
  })

  it("keeps a controlled value and marks the wrong box", async () => {
    const user = userEvent.setup()
    const seen: PersonName[] = []
    function Host() {
      const [value, setValue] = useState<PersonName>({ firstName: "", middleName: "", lastName: "" })
      return (
        <PersonNameBoxes
          labels={LABELS}
          value={value}
          invalid={{ lastName: !value.lastName }}
          onChange={(v) => {
            seen.push(v)
            setValue(v)
          }}
        />
      )
    }
    render(<Host />)
    expect(box("Last name")).toHaveAttribute("aria-invalid", "true")
    await user.click(box("First name"))
    await user.paste("Juma Ali Khamis")
    expect(seen.at(-1)).toEqual({ firstName: "JUMA", middleName: "ALI", lastName: "KHAMIS" })
    expect(box("Last name")).not.toHaveAttribute("aria-invalid")
  })
})

describe("StudentNameBoxes and FatherNameBoxes", () => {
  it("runs from the student's box into the father's group and posts the contract's names", async () => {
    const user = userEvent.setup()
    render(
      <form data-testid="form">
        <StudentNameBoxes labels={{ ...LABELS, student: "Student’s name", father: "Father’s name" }} />
      </form>,
    )
    const father = screen.getByRole("group", { name: "Father’s name" })
    expect(father).toContainElement(box("First name"))
    await user.click(box("Student’s name"))
    await user.keyboard("neema omari juma hassan")
    expect(posted(screen.getByTestId("form"))).toEqual({ firstName: "NEEMA", fatherFirst: "OMARI", fatherMiddle: "JUMA", fatherLast: "HASSAN" })
  })

  it("posts under the caller's names when given", () => {
    render(
      <form data-testid="form">
        <FatherNameBoxes labels={LABELS} names={{ fatherFirst: "s0[fatherFirst]" }} defaultValue={{ fatherFirst: "OMARI" }} />
      </form>,
    )
    expect(posted(screen.getByTestId("form"))).toEqual({ "s0[fatherFirst]": "OMARI", fatherMiddle: "", fatherLast: "" })
  })
})

describe("FullNameBox and CodeBox", () => {
  it("keeps the full name's spaces, in capitals", async () => {
    const user = userEvent.setup()
    render(<FullNameBox aria-label="Their full name" />)
    await user.type(box("Their full name"), "mwajuma said")
    expect(box("Their full name")).toHaveValue("MWAJUMA SAID")
  })

  it("adds the code's hyphen by itself", async () => {
    const user = userEvent.setup()
    const changes: string[] = []
    render(
      <form data-testid="form">
        <CodeBox name="code" aria-label="Discount code" onValueChange={(v) => changes.push(v)} />
      </form>,
    )
    await user.type(box("Discount code"), "aan132")
    expect(box("Discount code")).toHaveValue("AAN-132")
    expect(changes.at(-1)).toBe("AAN-132")
    expect(posted(screen.getByTestId("form"))).toEqual({ code: "AAN-132" })
  })
})

describe("Tabs", () => {
  const tabs = [
    { label: "Overview", href: "/r" },
    { label: "Interview", href: "/r?tab=interview" },
    { label: "School fee", href: "/r?tab=fee" },
  ]

  it("moves between the links with the arrow keys, Home and End", async () => {
    const user = userEvent.setup()
    render(<Tabs label="Record" tabs={tabs} current="/r" />)
    screen.getByRole("link", { name: "Overview" }).focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("link", { name: "Interview" })).toHaveFocus()
    await user.keyboard("{End}")
    expect(screen.getByRole("link", { name: "School fee" })).toHaveFocus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("link", { name: "Overview" })).toHaveFocus()
    await user.keyboard("{ArrowLeft}{Home}")
    expect(screen.getByRole("link", { name: "Overview" })).toHaveFocus()
  })
})

describe("TabSwitch", () => {
  it("chooses with a click or the arrow keys and shows the chosen panel", async () => {
    const user = userEvent.setup()
    const changes: string[] = []
    render(
      <TabSwitch
        label="Charts"
        onChange={(v) => changes.push(v)}
        tabs={["Week", "Month", "Year"].map((t) => ({ value: t.toLowerCase(), label: t, panel: <p>{t} chart</p> }))}
      />,
    )
    expect(screen.getByRole("tablist", { name: "Charts" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tabpanel", { name: "Week" })).toHaveTextContent("Week chart")
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("tabindex", "-1")

    await user.click(screen.getByRole("tab", { name: "Year" }))
    expect(screen.getByRole("tabpanel", { name: "Year" })).toHaveTextContent("Year chart")
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Week" })).toHaveFocus()
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true")
    await user.keyboard("{ArrowLeft}")
    expect(screen.getByRole("tab", { name: "Year" })).toHaveFocus()
    expect(changes).toEqual(["year", "week", "year"])
  })
})

describe("Pagination", () => {
  it("shows seven places at most, the first and last page always", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageWindow(3, 12)).toEqual([1, 2, 3, 4, 5, "gap", 12])
    expect(pageWindow(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12])
    expect(pageWindow(12, 12)).toEqual([1, "gap", 8, 9, 10, 11, 12])
  })

  it("marks the current page, disables Previous on page 1 and turns pages with buttons", async () => {
    const user = userEvent.setup()
    function Host() {
      const [page, setPage] = useState(1)
      return <Pagination label="Applicant pages" page={page} pageCount={12} onPage={setPage} previousLabel="Previous page" nextLabel="Next page" pageLabel={(n) => `Page ${n}`} />
    }
    render(<Host />)
    const nav = screen.getByRole("navigation", { name: "Applicant pages" })
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Next page" }))
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page")
    await user.click(screen.getByRole("button", { name: "Page 12" }))
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled()
    expect(nav).toHaveTextContent("…")
  })

  it("draws links for a server page and nothing for one page", () => {
    const { rerender } = render(<Pagination label="Audit pages" page={2} pageCount={3} href={(p) => `/audit?page=${p}`} previousLabel="Previous page" nextLabel="Next page" />)
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "/audit?page=3")
    expect(screen.getByRole("link", { name: "2" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/audit?page=1")
    rerender(<Pagination label="Audit pages" page={1} pageCount={1} href={(p) => `/audit?page=${p}`} previousLabel="Previous page" nextLabel="Next page" />)
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
  })
})

describe("Accordion", () => {
  it("opens one card at a time; a closed answer is inert", async () => {
    const user = userEvent.setup()
    render(<Accordion items={[{ title: "First?", content: <p>One</p> }, { title: "Second?", content: <p>Two</p> }]} />)
    const first = screen.getByRole("button", { name: "First?" })
    const second = screen.getByRole("button", { name: "Second?" })
    expect(first).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("heading", { level: 3, name: "Second?" })).toBeInTheDocument()
    expect(screen.getByText("Two").closest("[inert]")).not.toBeNull()
    await user.click(second)
    expect(first).toHaveAttribute("aria-expanded", "false")
    expect(second).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("One").closest("[inert]")).not.toBeNull()
    await user.click(second)
    expect(second).toHaveAttribute("aria-expanded", "false")
  })
})

describe("StepSlider, Tooltip and AvatarGroup", () => {
  it("says the value with its unit and labels each step", () => {
    const changes: number[] = []
    render(<StepSlider min={0} max={25} step={5} defaultValue={10} unit="%" aria-label="Discount, percent" onValueChange={(v) => changes.push(v)} />)
    const slider = screen.getByRole("slider", { name: "Discount, percent" })
    expect(slider).toHaveAttribute("aria-valuetext", "10%")
    fireEvent.change(slider, { target: { value: "15" } })
    expect(slider).toHaveAttribute("aria-valuetext", "15%")
    expect(changes).toEqual([15])
    expect(screen.getByText("25%")).toBeInTheDocument()
  })

  it("keeps the button's own name, drops its title, and hides on Escape", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Tooltip label="New requests">
        <RoundButton icon="bell" label="New requests" />
      </Tooltip>,
    )
    const button = screen.getByRole("button", { name: "New requests" })
    expect(button).not.toHaveAttribute("title")
    button.focus()
    await user.keyboard("{Escape}")
    expect(container.querySelector(".kit-tipw")).toHaveAttribute("data-dismissed")
  })

  it("hides a tooltip shown by the pointer on Escape, with focus elsewhere, until the pointer leaves", () => {
    const { container } = render(
      <Tooltip label="New requests">
        <RoundButton icon="bell" label="New requests" />
      </Tooltip>,
    )
    const wrap = container.querySelector(".kit-tipw") as HTMLElement
    fireEvent.pointerEnter(wrap)
    fireEvent.keyDown(document.body, { key: "Escape" })
    expect(wrap).toHaveAttribute("data-dismissed")
    fireEvent.pointerLeave(wrap)
    expect(wrap).not.toHaveAttribute("data-dismissed")
  })

  it("names the group and counts the people not shown", () => {
    render(<AvatarGroup people={["RM", "AS", "JK", "LO", "BS", "MK"].map((initials) => ({ initials }))} label="Rehema M. and 5 others" />)
    const group = screen.getByRole("img", { name: "Rehema M. and 5 others" })
    expect(group).toHaveTextContent("+2")
  })
})

describe("tabs while a page loads, and a keyboard still composing", () => {
  const tabs = [
    { label: "A", href: "/a" },
    { label: "B", href: "/b" },
  ]
  const on = () => screen.getAllByRole("link").filter((l) => l.hasAttribute("data-on")).map((l) => l.textContent)

  it("lights the clicked tab at once, keeps aria-current on the page shown, and follows the browser's Back", () => {
    const { rerender } = render(<Tabs label="T" tabs={tabs} current="/a" />)
    fireEvent.click(screen.getByRole("link", { name: "B" }))
    expect(on()).toEqual(["B"])
    expect(screen.getByRole("link", { name: "A" })).toHaveAttribute("aria-current", "page")
    rerender(<Tabs label="T" tabs={tabs} current="/b" />)
    expect(on()).toEqual(["B"])
    rerender(<Tabs label="T" tabs={tabs} current="/a" />)
    expect(on()).toEqual(["A"])
    expect(screen.getByRole("link", { name: "A" })).toHaveAttribute("aria-current", "page")
  })

  it("leaves Enter and Backspace to a keyboard that is still composing", () => {
    render(<PersonNameBoxes labels={LABELS} />)
    box("Middle name").focus()
    fireEvent.keyDown(box("Middle name"), { key: "Enter", isComposing: true })
    fireEvent.keyDown(box("Middle name"), { key: "Backspace", keyCode: 229 })
    expect(box("Middle name")).toHaveFocus()
    fireEvent.keyDown(box("Middle name"), { key: "Enter" })
    expect(box("Last name")).toHaveFocus()
  })
})
