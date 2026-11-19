import { fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { CodePicker, codeKey, completeCode, filterCodeOptions, sortCodeOptions, type CodeOption } from "@/components/guided-form"
import { codeOptionOf } from "@/app/staff/check-in/new/code-options"

// The Discount code box with its list (owner, 2026-11-19): Promo codes first,
// then agent codes, each A to Z; a search over codes and names; and a faint
// completion of the first listed code the typed letters begin. Invented codes.

const CODES: CodeOption[] = [
  { kind: "agent", code: "NZR-215", detail: "Neema Zuberi Rajabu" },
  { kind: "promo", code: "SAVE10", detail: "TZS 10,000 off" },
  { kind: "agent", code: "BJN-402", detail: "Baraka Juma Ngowi" },
  { kind: "promo", code: "EID2026", detail: "TZS 5,000 off" },
  { kind: "agent", code: "ASM-104", detail: "Asha Said Mfano" },
]

describe("the list's rules", () => {
  it("puts Promo codes first, then agent codes, each A to Z", () => {
    expect(sortCodeOptions(CODES).map((c) => c.code)).toEqual(["EID2026", "SAVE10", "ASM-104", "BJN-402", "NZR-215"])
  })

  it("compares codes without the hyphen the box adds after three letters", () => {
    expect(codeKey("eid-2026")).toBe("EID2026")
    expect(codeKey("BJN-402")).toBe("BJN402")
    expect(codeKey("AS-135")).toBe("AS-135")
  })

  it("searches the code and the name, ignoring case, spaces and the agent hyphen", () => {
    const sorted = sortCodeOptions(CODES)
    expect(filterCodeOptions("neema", sorted).map((c) => c.code)).toEqual(["NZR-215"])
    expect(filterCodeOptions("bjn4", sorted).map((c) => c.code)).toEqual(["BJN-402"])
    expect(filterCodeOptions("eid-20", sorted).map((c) => c.code)).toEqual(["EID2026"])
    expect(filterCodeOptions("10,000", sorted).map((c) => c.code)).toEqual(["SAVE10"])
    expect(filterCodeOptions("  ", sorted)).toHaveLength(5)
    expect(filterCodeOptions("xyz", sorted)).toEqual([])
  })

  it("completes the typed letters to the first code in list order", () => {
    const sorted = sortCodeOptions(CODES)
    expect(completeCode("B", sorted)).toBe("BJN-402")
    expect(completeCode("BJN", sorted)).toBe("BJN-402")
    expect(completeCode("BJN-4", sorted)).toBe("BJN-402")
    // The box turns EID2 into EID-2; the completion keeps what was typed.
    expect(completeCode("EID-2", sorted)).toBe("EID-2026")
    expect(completeCode("S", sorted)).toBe("SAVE10")
    expect(completeCode("BJN-402", sorted)).toBeNull()
    expect(completeCode("Q", sorted)).toBeNull()
    expect(completeCode("", sorted)).toBeNull()
  })

  it("never swaps a whole listed code for a longer one", () => {
    const overlapping = sortCodeOptions([
      { kind: "promo", code: "SAVE100", detail: "TZS 20,000 off" },
      { kind: "promo", code: "SAVE10", detail: "TZS 10,000 off" },
      { kind: "agent", code: "ABC-123", detail: "Amina Bakari Chande" },
      { kind: "promo", code: "ABC1234", detail: "TZS 5,000 off" },
    ])
    expect(completeCode("SAVE1", overlapping)).toBe("SAVE10")
    expect(completeCode("SAVE10", overlapping)).toBeNull()
    // A whole agent code stays, though a Promo code listed before it begins the same way.
    expect(completeCode("ABC-123", overlapping)).toBeNull()
    expect(completeCode("ABC123", overlapping)).toBeNull()
  })

  it("shows an agent's name beside the code, and what a Promo code takes off", () => {
    expect(codeOptionOf({ kind: "agent", code: "BJN-402", holderName: "Baraka Juma Ngowi", amountOff: 10_000 })).toEqual({
      kind: "agent",
      code: "BJN-402",
      detail: "Baraka Juma Ngowi",
    })
    expect(codeOptionOf({ kind: "promo", code: "SAVE10", holderName: "Ten off", amountOff: 10_000 })).toEqual({
      kind: "promo",
      code: "SAVE10",
      detail: "TZS 10,000 off",
    })
  })
})

function Picker({ listState = "ready" as const }: { listState?: "ready" | "loading" | "unavailable" }) {
  const [value, setValue] = useState("")
  return (
    <CodePicker
      value={value}
      onValueChange={setValue}
      options={listState === "ready" ? CODES : []}
      listState={listState}
      placeholder="Discount code, e.g. ABC-123"
      aria-label="Discount code"
    />
  )
}

describe("the box", () => {
  it("keeps the placeholder and takes a typed code as before", () => {
    render(<Picker />)
    const box = screen.getByRole("combobox", { name: "Discount code" })
    expect(box).toHaveAttribute("placeholder", "Discount code, e.g. ABC-123")
    fireEvent.change(box, { target: { value: "bjn402" } })
    expect(box).toHaveValue("BJN-402")
  })

  it("takes the faint completion with Tab, and ignores it when typing on", () => {
    render(<Picker />)
    const box = screen.getByRole("combobox", { name: "Discount code" })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: "b" } })
    expect(box.parentElement).toHaveTextContent("BJN-402")
    fireEvent.keyDown(box, { key: "Tab" })
    expect(box).toHaveValue("BJN-402")

    fireEvent.change(box, { target: { value: "Q" } })
    fireEvent.keyDown(box, { key: "Tab" })
    expect(box).toHaveValue("Q")
  })

  it("opens the list from the arrow, Promo codes first, and fills the box with the code picked", () => {
    render(<Picker />)
    fireEvent.click(screen.getByRole("button", { name: "Show all Discount codes" }))
    const list = screen.getByRole("listbox", { name: "Discount codes" })
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "EID2026TZS 5,000 off",
      "SAVE10TZS 10,000 off",
      "ASM-104Asha Said Mfano",
      "BJN-402Baraka Juma Ngowi",
      "NZR-215Neema Zuberi Rajabu",
    ])
    expect(within(list).getByText("Promo codes")).toBeInTheDocument()
    expect(within(list).getByText("Agent codes")).toBeInTheDocument()

    fireEvent.change(screen.getByRole("combobox", { name: "Search Discount codes" }), { target: { value: "neema" } })
    expect(within(list).getAllByRole("option")).toHaveLength(1)
    fireEvent.click(within(list).getByRole("option", { name: /NZR-215/ }))

    expect(screen.getByRole("combobox", { name: "Discount code" })).toHaveValue("NZR-215")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("picks with the arrow keys and Enter, and closes with Esc", () => {
    render(<Picker />)
    fireEvent.click(screen.getByRole("button", { name: "Show all Discount codes" }))
    const search = screen.getByRole("combobox", { name: "Search Discount codes" })
    fireEvent.keyDown(search, { key: "ArrowDown" })
    fireEvent.keyDown(search, { key: "Enter" })
    expect(screen.getByRole("combobox", { name: "Discount code" })).toHaveValue("SAVE10")

    fireEvent.click(screen.getByRole("button", { name: "Show all Discount codes" }))
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search Discount codes" }), { key: "Escape" })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("says when nothing matches, and when the list could not be read", () => {
    const { unmount } = render(<Picker />)
    fireEvent.click(screen.getByRole("button", { name: "Show all Discount codes" }))
    fireEvent.change(screen.getByRole("combobox", { name: "Search Discount codes" }), { target: { value: "xyz" } })
    expect(screen.getByText("No code matches “xyz”. You can still type the code in the box.")).toBeInTheDocument()
    unmount()

    render(<Picker listState="unavailable" />)
    fireEvent.click(screen.getByRole("button", { name: "Show all Discount codes" }))
    expect(screen.getByText("The list could not be loaded. Type the code in the box.")).toBeInTheDocument()
  })
})
