import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ saveFatherName: vi.fn(), savePreviousSchool: vi.fn(), sendSiblingRequest: vi.fn() }))
vi.mock("@/app/staff/applicants/[id]/sibling-actions", () => ({
  saveFatherName: actions.saveFatherName,
  savePreviousSchool: actions.savePreviousSchool,
  sendSiblingRequest: actions.sendSiblingRequest,
  previewGrant: vi.fn(),
  decideSibling: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { FatherNameRow } from "@/app/staff/applicants/[id]/father-school"

// "One name, or two?" on the record (#310): the first answer picked is the
// one saved, once, however fast a second tile is pressed after it.

const QUESTION = {
  status: "question",
  fatherFullName: "ALI MUSSA KHAMISI",
  sibling: { leadId: "khalid", firstName: "KHALID", studentName: "KHALID ALI MUSSA KHAMIS", father: "ALI MUSSA KHAMIS" },
  holders: ["KHALID"],
}

describe("One name, or two?", () => {
  beforeEach(() => {
    actions.saveFatherName.mockReset()
    actions.saveFatherName.mockResolvedValueOnce(QUESTION).mockResolvedValue({ status: "saved", message: "Saved as one name. Still siblings." })
  })
  afterEach(() => vi.useRealTimers())

  it("saves only the first answer when two are picked within the pause", async () => {
    render(
      <FatherNameRow
        leadId="zuhura"
        studentName="ZUHURA ALI MUSSA KHAMIS"
        father="ALI MUSSA KHAMIS"
        enrolled={false}
        compareWith={null}
        canEdit
        onChanged={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Edit father’s full name" }))
    fireEvent.change(screen.getByPlaceholderText("Last name"), { target: { value: "KHAMISI" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }))
    })
    const sheet = await screen.findByRole("dialog", { name: "One name, or two?" })
    const radios = within(sheet).getAllByRole("radio")
    // The pause before the save, on a clock the test moves.
    vi.useFakeTimers()

    await act(async () => {
      fireEvent.click(radios[1])
      fireEvent.click(radios[2])
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(actions.saveFatherName).toHaveBeenCalledTimes(2)
    expect(actions.saveFatherName).toHaveBeenLastCalledWith("zuhura", "ALI MUSSA KHAMISI", "typo-theirs", "ALI MUSSA KHAMIS")
  })
})
