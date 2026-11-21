import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ correctContact: vi.fn() }))
vi.mock("@/app/staff/applicants/[id]/actions", () => ({ correctContact: actions.correctContact, correctStudent: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { CustodianSheet, type CustodianView } from "@/app/staff/family/custodian-sheet"

// Change the custodian on the Family page (#512): partial updates, WhatsApp
// matching the phone, and keeping a father's contact name read-only here.

function Sheet({ custodian }: { custodian: CustodianView }) {
  const [open, setOpen] = useState(true)
  return <CustodianSheet custodian={custodian} open={open} onOpenChange={setOpen} />
}

const sheet = () => screen.getByRole("dialog", { name: "Change the custodian" })
const save = () =>
  act(async () => {
    fireEvent.click(within(sheet()).getByRole("button", { name: "Save" }))
  })

const MOTHER: CustodianView = {
  contactId: "c1",
  fullName: "MWANAIDI SALIM MRISHO",
  phone: "+255712345678",
  whatsapp: null,
  members: [{ leadId: "l1", relationship: "Mother", relationshipDescription: null }],
  children: [{ id: "l1", studentName: "NEEMA JUMA MRISHO", admissionNumber: "ADMSN-00001" }],
}

beforeEach(() => {
  actions.correctContact.mockReset().mockResolvedValue({ status: "saved" })
})

describe("CustodianSheet", () => {
  it("treats a WhatsApp number equal to the phone as empty instead of sending a lone whatsapp write", async () => {
    render(<Sheet custodian={MOTHER} />)
    fireEvent.change(within(sheet()).getByLabelText("WhatsApp number, if different"), { target: { value: "0712 345 678" } })
    await save()
    expect(actions.correctContact).not.toHaveBeenCalled()
  })

  it("clears a stored WhatsApp number with null when staff enters the custodian's own phone", async () => {
    render(<Sheet custodian={{ ...MOTHER, whatsapp: "+255799888777" }} />)
    fireEvent.change(within(sheet()).getByLabelText("WhatsApp number, if different"), { target: { value: "0712 345 678" } })
    await save()
    expect(actions.correctContact).toHaveBeenCalledWith("c1", { whatsapp: null }, ["l1"], "l1")
  })

  it("does not allow renaming a custodian who is the father of any student on the page", async () => {
    const mixed: CustodianView = {
      contactId: "c2",
      fullName: "JUMA SALIM MRISHO",
      phone: "+255712345678",
      whatsapp: null,
      members: [
        { leadId: "l1", relationship: "Father", relationshipDescription: null },
        { leadId: "l2", relationship: "Guardian", relationshipDescription: null },
      ],
      children: [
        { id: "l1", studentName: "NEEMA JUMA MRISHO", admissionNumber: "ADMSN-00001" },
        { id: "l2", studentName: "ZAWADI RASHIDI SAID", admissionNumber: "ADMSN-00002" },
      ],
    }
    render(<Sheet custodian={mixed} />)
    expect(within(sheet()).queryByPlaceholderText("First name")).toBeNull()
    expect(within(sheet()).queryByRole("radiogroup")).toBeNull()
    fireEvent.change(within(sheet()).getByLabelText("Mobile number"), { target: { value: "0788 111 222" } })
    await save()
    expect(actions.correctContact).toHaveBeenCalledWith("c2", { phone: "0788 111 222" }, ["l1", "l2"], "l1")
  })
})
