import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { Checkbox, DateField, DateTimeField, Disclosure, FilePicker, RoundButton, Select, Sheet, Switch, Tabs, TextArea } from "@/components/kit"

// The kit's form parts (#358): what each one posts from a plain form, and
// how it keeps a controlled value. The browser tests on /staff/kit cover the
// popups, the keyboard and the look.

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; scroll?: boolean }) => {
    // next/link's scroll is not an attribute of <a>.
    const attributes: Record<string, unknown> = { ...props }
    delete attributes.scroll
    return (
      <a href={href} {...attributes}>
        {children}
      </a>
    )
  },
}))

const posted = (form: HTMLFormElement) => Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]))

function inForm(ui: React.ReactNode) {
  render(<form data-testid="form">{ui}</form>)
  return screen.getByTestId("form") as HTMLFormElement
}

describe("Select", () => {
  const options = [
    { value: "", label: "Anyone" },
    { value: "a1", label: "Asha" },
  ]

  it("posts its value from a form, the empty string as a real choice", () => {
    const form = inForm(<Select id="who" name="who" defaultValue="" options={options} aria-label="Who" />)
    expect(posted(form)).toEqual({ who: "" })
    const button = screen.getByRole("combobox", { name: "Who" })
    expect(button).toHaveTextContent("Anyone")
    expect(button).not.toHaveAttribute("data-empty")
  })

  it("shows the placeholder only when no option has the value", () => {
    render(<Select aria-label="Reason" placeholder="Choose a reason" options={[{ value: "x", label: "X" }]} value="" onValueChange={() => {}} />)
    const button = screen.getByRole("combobox", { name: "Reason" })
    expect(button).toHaveTextContent("Choose a reason")
    expect(button).toHaveAttribute("data-empty", "")
  })

  it("is named by a label for its id and marks itself invalid", () => {
    render(
      <>
        <label htmlFor="t">Payment type</label>
        <Select id="t" options={options} value="a1" onValueChange={() => {}} invalid aria-describedby="t-err" />
        <p id="t-err">Choose one.</p>
      </>,
    )
    const button = screen.getByRole("combobox", { name: "Payment type" })
    expect(button).toHaveAttribute("aria-invalid", "true")
    expect(button).toHaveAccessibleDescription("Choose one.")
    expect(button).toHaveTextContent("Asha")
  })
})

describe("DateField", () => {
  it("posts YYYY-MM-DD uncontrolled, and the empty string for text that is not a date", () => {
    const form = inForm(
      <>
        <label htmlFor="from">From</label>
        <DateField id="from" name="from" defaultValue="2026-09-05" />
      </>,
    )
    const input = screen.getByLabelText("From")
    expect(input).toHaveValue("05/09/2026")
    expect(posted(form)).toEqual({ from: "2026-09-05" })
    fireEvent.change(input, { target: { value: "1/10/2026" } })
    expect(posted(form)).toEqual({ from: "2026-10-01" })
    fireEvent.change(input, { target: { value: "31/02/2026" } })
    expect(posted(form)).toEqual({ from: "" })
  })

  it("shows the message when a wrong date is left, and links it", () => {
    render(
      <>
        <label htmlFor="d">Payment date</label>
        <DateField id="d" value="" onChange={() => {}} aria-describedby="d-hint" />
        <p id="d-hint">Today or earlier.</p>
      </>,
    )
    const input = screen.getByLabelText("Payment date")
    fireEvent.change(input, { target: { value: "31/02/2026" } })
    fireEvent.blur(input)
    expect(screen.getByText("Type the date as day/month/year, for example 25/09/2026.").closest("[role=alert]")).not.toBeNull()
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(input).toHaveAccessibleDescription(/Today or earlier\. Type the date/)
  })

  it("calls onChange with YYYY-MM-DD or the empty string, and keeps half-typed text", () => {
    const seen: string[] = []
    function Host() {
      const [value, setValue] = useState("2026-11-12")
      return (
        <>
          <label htmlFor="d">Due</label>
          <DateField
            id="d"
            value={value}
            onChange={(next) => {
              seen.push(next)
              setValue(next)
            }}
          />
          <button type="button" onClick={() => setValue("")}>
            Clear
          </button>
        </>
      )
    }
    render(<Host />)
    const input = screen.getByLabelText("Due")
    expect(input).toHaveValue("12/11/2026")
    fireEvent.change(input, { target: { value: "12/11/20" } })
    expect(input).toHaveValue("12/11/20")
    fireEvent.change(input, { target: { value: "5/1/2027" } })
    fireEvent.blur(input)
    expect(input).toHaveValue("05/01/2027")
    expect(seen).toEqual(["", "2027-01-05"])
    fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    expect(input).toHaveValue("")
  })

  it("puts the first value back when its form is reset", () => {
    const form = inForm(<DateField aria-label="From" name="from" defaultValue="2026-09-05" />)
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "01/01/2026" } })
    act(() => form.reset())
    expect(screen.getByLabelText("From")).toHaveValue("05/09/2026")
    expect(posted(form)).toEqual({ from: "2026-09-05" })
  })
})

describe("DateTimeField", () => {
  it("posts the datetime-local format once both parts are complete", () => {
    const form = inForm(<DateTimeField name="at" defaultValue="2026-11-12T14:30" />)
    expect(posted(form)).toEqual({ at: "2026-11-12T14:30" })
    const time = screen.getByLabelText("Time, 24-hour clock")
    fireEvent.change(time, { target: { value: "930" } })
    expect(posted(form)).toEqual({ at: "2026-11-12T09:30" })
    fireEvent.blur(time)
    expect(time).toHaveValue("09:30")
    fireEvent.change(time, { target: { value: "25:00" } })
    fireEvent.blur(time)
    expect(posted(form)).toEqual({ at: "" })
    expect(screen.getByText("Type the time as hours:minutes, for example 14:30.")).toBeInTheDocument()
  })

  it("calls onChange with the joined value", () => {
    const onChange = vi.fn()
    render(<DateTimeField id="at" value="2026-11-12T14:30" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "13/11/2026" } })
    expect(onChange).toHaveBeenLastCalledWith("2026-11-13T14:30")
    fireEvent.change(screen.getByLabelText("Time, 24-hour clock"), { target: { value: "0805" } })
    // The typed date stands though the parent kept its value, as a native input would.
    expect(onChange).toHaveBeenLastCalledWith("2026-11-13T08:05")
  })
})

describe("TextArea", () => {
  it("posts its text, keeps maxLength and marks itself invalid", () => {
    const form = inForm(<TextArea aria-label="Note" name="note" defaultValue="Hello" maxLength={500} invalid />)
    const area = screen.getByRole("textbox", { name: "Note" })
    expect(area).toHaveAttribute("maxlength", "500")
    expect(area).toHaveAttribute("aria-invalid", "true")
    expect(posted(form)).toEqual({ note: "Hello" })
  })
})

describe("Checkbox and Switch", () => {
  it("posts a ticked box with its form and toggles from its row", () => {
    const form = inForm(
      <>
        <Checkbox name="a" label="Pre-Form One programme" hint="Its fee is charged on its own." />
        <Checkbox name="b" label="Has a sibling" defaultChecked />
      </>,
    )
    expect(posted(form)).toEqual({ b: "on" })
    const a = screen.getByRole("checkbox", { name: "Pre-Form One programme" })
    expect(a).toHaveAccessibleDescription("Its fee is charged on its own.")
    fireEvent.click(screen.getByText("Pre-Form One programme"))
    expect(a).toBeChecked()
    expect(posted(form)).toEqual({ a: "on", b: "on" })
  })

  it("is named by a label placed elsewhere and works controlled", () => {
    const onCheckedChange = vi.fn()
    render(
      <>
        <label htmlFor="perm">Record payments</label>
        <Checkbox id="perm" checked={false} onCheckedChange={onCheckedChange} aria-describedby="perm-hint" />
        <p id="perm-hint">Money in.</p>
      </>,
    )
    const box = screen.getByRole("checkbox", { name: "Record payments" })
    expect(box).toHaveAccessibleDescription("Money in.")
    fireEvent.click(box)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it("draws a switch with role switch", () => {
    render(<Switch label="Example switch, on" defaultChecked />)
    expect(screen.getByRole("switch", { name: "Example switch, on" })).toBeChecked()
  })
})

describe("Tabs", () => {
  it("is a named nav of links, the current one marked, with children after the tabs", () => {
    render(
      <Tabs label="Agent status" tabs={[{ label: "Active (12)", href: "/a" }, { label: "Archived (3)", href: "/a?s=archived" }]} current="/a">
        <a href="/a">Clear search</a>
      </Tabs>,
    )
    const nav = screen.getByRole("navigation", { name: "Agent status" })
    expect(screen.getByRole("link", { name: "Active (12)" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Archived (3)" })).not.toHaveAttribute("aria-current")
    expect(nav.lastElementChild).toHaveTextContent("Clear search")
  })
})

describe("Disclosure", () => {
  it("folds open and shut, with closed content inert, and opens from outside", () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Show the error
          </button>
          <Disclosure variant="boxed" label="More options" open={open}>
            <input aria-label="Ends on" />
          </Disclosure>
        </>
      )
    }
    render(<Host />)
    const toggle = screen.getByRole("button", { name: "More options" })
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(panel.firstElementChild).toHaveAttribute("inert")
    fireEvent.click(screen.getByRole("button", { name: "Show the error" }))
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(panel.firstElementChild).not.toHaveAttribute("inert")
    // The person can still fold it after.
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "false")
  })
})

describe("FilePicker", () => {
  it("keeps a real, labelled file input in its form and shows the chosen file's name", () => {
    const form = inForm(
      <>
        <label htmlFor="csv">CSV file</label>
        <FilePicker id="csv" name="file" accept=".csv,text/csv" required title="Drop the CSV here or choose a file" chooseLabel="Choose file" />
      </>,
    )
    const input = screen.getByLabelText("CSV file") as HTMLInputElement
    expect(input).toHaveAttribute("type", "file")
    expect(input).toHaveAttribute("name", "file")
    expect(input).toHaveAttribute("accept", ".csv,text/csv")
    expect(input).toBeRequired()
    expect(input.form).toBe(form)
    const file = new File(["name\n"], "agents.csv", { type: "text/csv" })
    fireEvent.change(input, { target: { files: [file] } })
    expect(screen.getByText("agents.csv")).toBeInTheDocument()
  })
})

describe("RoundButton on", () => {
  it("keeps its name and marks the on state", () => {
    render(<RoundButton icon="filter" label="Filter Visited applicants" on />)
    const button = screen.getByRole("button", { name: "Filter Visited applicants" })
    expect(button).toHaveAttribute("data-on", "")
    expect(button.querySelector("circle.gf-ic-glow")).not.toBeNull()
  })
})

describe("Sheet hintId", () => {
  it("gives the hint the id a field can point at", () => {
    render(
      <Sheet open onOpenChange={() => {}} title="New agent" hint="Their code is made from the name." hintId="sheet-hint" closeLabel="Close">
        <input aria-label="Name" aria-describedby="sheet-hint" />
      </Sheet>,
    )
    expect(document.getElementById("sheet-hint")).toHaveTextContent("Their code is made from the name.")
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription("Their code is made from the name.")
    expect(screen.getByRole("dialog", { name: "New agent" })).toHaveAccessibleDescription("Their code is made from the name.")
  })
})
