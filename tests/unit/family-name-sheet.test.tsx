import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ saveFatherName: vi.fn(), correctStudent: vi.fn() }))
vi.mock("@/app/staff/applicants/[id]/sibling-actions", () => ({
  saveFatherName: actions.saveFatherName,
  savePreviousSchool: vi.fn(),
  sendSiblingRequest: vi.fn(),
  previewGrant: vi.fn(),
  decideSibling: vi.fn(),
}))
vi.mock("@/app/staff/applicants/[id]/actions", () => ({ correctStudent: actions.correctStudent, correctContact: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { NameSheet } from "@/app/staff/family/name-sheet"

// Change the name on the Family page (#512): what is sent for the student's
// name when only the student's own name changes, when the father's name
// changes, and when the student's name is refused after the father's saved.

function Sheet({ studentName, father }: { studentName: string; father: string }) {
  const [open, setOpen] = useState(true)
  return (
    <NameSheet leadId="lead" studentName={studentName} father={father} enrolled={false} compareWith={null} open={open} onOpenChange={setOpen} onBusy={() => {}} />
  )
}

const sheet = () => screen.getByRole("dialog", { name: "Change the name" })
const type = (placeholder: string, value: string) => fireEvent.change(within(sheet()).getByPlaceholderText(placeholder), { target: { value } })
const save = () =>
  act(async () => {
    fireEvent.click(within(sheet()).getByRole("button", { name: "Save" }))
  })
const sentName = (call: number) => actions.correctStudent.mock.calls[call][1].fullName

// Picks an answer to "One name, or two?" and lets its pause and save run.
async function answer(index: number) {
  const radios = within(await screen.findByRole("dialog", { name: "One name, or two?" })).getAllByRole("radio")
  vi.useFakeTimers()
  await act(async () => {
    fireEvent.click(radios[index])
    await vi.advanceTimersByTimeAsync(1000)
  })
  vi.useRealTimers()
}

beforeEach(() => {
  actions.saveFatherName.mockReset()
  actions.correctStudent.mockReset().mockResolvedValue({ status: "saved" })
})
afterEach(() => vi.useRealTimers())

describe("only the student's own name changes", () => {
  it("keeps a last name of two words, and never touches the father's name", async () => {
    render(<Sheet studentName="NEEMA JUMA DE SOUZA" father="JUMA SALIM DE SOUZA" />)
    type("Student’s name", "AMINA")
    expect(sheet()).toHaveTextContent("Student’s full name: AMINA JUMA DE SOUZA")
    await save()

    expect(actions.correctStudent).toHaveBeenCalledTimes(1)
    expect(actions.correctStudent.mock.calls[0]).toEqual(["lead", { fullName: "AMINA JUMA DE SOUZA", className: undefined, dayOrBoarding: undefined }])
    expect(actions.saveFatherName).not.toHaveBeenCalled()
  })

  it("keeps the rest of the stored name when it differs from the father's name on record", async () => {
    render(<Sheet studentName="NEEMA JUMA DE SOUZA" father="JUMA SALIM DA SOUZA" />)
    type("Student’s name", "AMINA")
    await save()
    expect(sentName(0)).toBe("AMINA JUMA DE SOUZA")
  })

  it("asks for no middle name of a father on record with two names", async () => {
    render(<Sheet studentName="NEEMA ALI MOHAMED" father="ALI MOHAMED" />)
    type("Student’s name", "AMINA")
    await save()
    expect(sentName(0)).toBe("AMINA ALI MOHAMED")
  })
})

describe("the father's name changes", () => {
  it("saves the father's name first, then the student's name from the boxes", async () => {
    actions.saveFatherName.mockResolvedValue({ status: "saved", message: "Father’s name saved." })
    render(<Sheet studentName="NEEMA JUMA MRISHO" father="JUMA SALIM MRISHO" />)
    type("Last name", "KOMBO")
    await save()

    expect(actions.saveFatherName).toHaveBeenCalledWith("lead", "JUMA SALIM KOMBO", null, null)
    expect(sentName(0)).toBe("NEEMA JUMA KOMBO")
  })

  it("keeps a mismatched student name whole when only the father's middle name changes", async () => {
    actions.saveFatherName.mockResolvedValue({ status: "saved", message: "Father’s name saved." })
    render(<Sheet studentName="NEEMA JUMA DE SOUZA" father="JUMA SALIM DA SOUZA" />)
    type("Middle name", "SALIM DE")
    expect(sheet()).toHaveTextContent("Student’s full name: NEEMA JUMA DE SOUZA")
    await save()

    expect(actions.saveFatherName).toHaveBeenCalledWith("lead", "JUMA SALIM DE SOUZA", null, null)
    expect(actions.correctStudent).not.toHaveBeenCalled()
  })

  it("keeps a mismatched two-word last name when both the student's own name and the father's middle name change", async () => {
    actions.saveFatherName.mockResolvedValue({ status: "saved", message: "Father’s name saved." })
    render(<Sheet studentName="NEEMA JUMA DE SOUZA" father="JUMA SALIM DA SOUZA" />)
    type("Student’s name", "AMINA")
    type("Middle name", "SALIM DE")
    expect(sheet()).toHaveTextContent("Student’s full name: AMINA JUMA DE SOUZA")
    await save()

    expect(actions.saveFatherName).toHaveBeenCalledWith("lead", "JUMA SALIM DE SOUZA", null, null)
    expect(sentName(0)).toBe("AMINA JUMA DE SOUZA")
  })

  it("does not rewrite an imported student name when only the father's middle name changes", async () => {
    actions.saveFatherName.mockResolvedValue({ status: "saved", message: "Father’s name saved." })
    render(<Sheet studentName="NEEMA MRISHO" father="JUMA SALIM MRISHO" />)
    type("Middle name", "SALEM")
    expect(sheet()).toHaveTextContent("Student’s full name: NEEMA MRISHO")
    await save()

    expect(actions.saveFatherName).toHaveBeenCalledWith("lead", "JUMA SALEM MRISHO", null, null)
    expect(actions.correctStudent).not.toHaveBeenCalled()
  })

  it("asks for all three of the father's names", async () => {
    render(<Sheet studentName="NEEMA JUMA MRISHO" father="JUMA SALIM MRISHO" />)
    type("Middle name", "")
    await save()
    expect(within(sheet()).getByRole("alert")).toHaveTextContent("all three of the father’s names")
    expect(actions.saveFatherName).not.toHaveBeenCalled()
  })

  it("takes the sibling's spelling whole when the desk chooses it, a last name of two words included", async () => {
    actions.saveFatherName
      .mockResolvedValueOnce({
        status: "question",
        fatherFullName: "JUMA SAALIM DE SOUZA",
        sibling: { leadId: "salma", firstName: "SALMA", studentName: "SALMA JUMA DE SOUZA", father: "JUMA SALIM DE SOUZA" },
        holders: ["SALMA"],
      })
      .mockResolvedValue({ status: "saved", message: "Saved as one name. Still siblings." })
    render(<Sheet studentName="NEEMA JUMA DE SOUZA" father="JUMA SALEM DE SOUZA" />)
    type("Student’s name", "AMINA")
    type("Middle name", "SAALIM")
    await save()
    await answer(1)

    expect(actions.saveFatherName).toHaveBeenLastCalledWith("lead", "JUMA SAALIM DE SOUZA", "typo-theirs", "JUMA SALIM DE SOUZA")
    expect(sentName(0)).toBe("AMINA JUMA DE SOUZA")
  })
})

describe("the student's name is refused after the father's name was saved", () => {
  it("opens the sheet again saying so, and Save then sends the student's name alone", async () => {
    actions.saveFatherName
      .mockResolvedValueOnce({
        status: "question",
        fatherFullName: "ALI MUSSA KHAMISI",
        sibling: { leadId: "khalid", firstName: "KHALID", studentName: "KHALID ALI KHAMIS", father: "ALI KHAMIS" },
        holders: ["KHALID"],
      })
      .mockResolvedValue({ status: "saved", message: "Saved as one name. Still siblings." })
    actions.correctStudent.mockResolvedValueOnce({ status: "duplicate", admissionNumber: "ADMSN-00001", href: "/staff/applicants/x" })
    render(<Sheet studentName="ZUHURA ALI KHAMIS" father="ALI MUSSA KHAMIS" />)
    type("Student’s name", "KHALIDA")
    type("Last name", "KHAMISI")
    await save()
    await answer(1)

    // The father's name took the sibling's spelling, which has two names; the student's name was refused.
    expect(sentName(0)).toBe("KHALIDA ALI KHAMIS")
    const alert = await within(await screen.findByRole("dialog", { name: "Change the name" })).findByRole("alert")
    expect(alert).toHaveTextContent("The father’s name was saved, but the student’s name was not.")
    expect(within(sheet()).getByPlaceholderText("Student’s name")).toHaveValue("KHALIDA")
    expect(within(sheet()).getByPlaceholderText("Last name")).toHaveValue("KHAMIS")

    type("Student’s name", "KHADIJA")
    await save()
    expect(actions.correctStudent).toHaveBeenCalledTimes(2)
    expect(sentName(1)).toBe("KHADIJA ALI KHAMIS")
    // The father's name is not sent again, and his missing middle name is not asked for.
    expect(actions.saveFatherName).toHaveBeenCalledTimes(2)
  })
})
