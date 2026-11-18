import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ correct: vi.fn(), outlook: vi.fn() }))
vi.mock("@/app/staff/applicants/[id]/gender-actions", () => ({
  correctGender: actions.correct,
  genderOutlookAction: actions.outlook,
}))

import { GenderSheet } from "@/app/staff/applicants/[id]/gender-sheet"

// The Boy or girl sheet (#449, v42): a change is saved only after what it
// does to the child's seat has been read and shown.

const MOVES = {
  placed: { id: "b", className: "FORM 1", label: "B", takes: "Boys" },
  moves: true,
  wouldTake: { id: "a", className: "FORM 1", label: "A", takes: "Girls" },
}
// What the read says for a child with no seat to lose, and before streams are on.
const NO_MOVE = { placed: null, moves: false, wouldTake: null }

function sheet() {
  render(<GenderSheet leadId="lead-1" studentName="Juma Ali Mrisho" className="FORM 1" gender="Boy" />)
}

async function pickGirl(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Change" }))
  await user.click(screen.getByRole("radio", { name: "Girl" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.correct.mockResolvedValue({ status: "saved" })
})

describe("GenderSheet", () => {
  it("warns before a change moves a placed child, then saves", async () => {
    actions.outlook.mockResolvedValue(MOVES)
    const user = userEvent.setup()
    sheet()
    await pickGirl(user)
    expect(await screen.findByText("This moves her out of FORM 1 B (Boys).")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(actions.correct).toHaveBeenCalledWith("lead-1", "Girl"))
  })

  it("saves nothing when what the change does can't be read", async () => {
    actions.outlook.mockRejectedValue(new Error("offline"))
    const user = userEvent.setup()
    sheet()
    await pickGirl(user)
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByText("Some details could not be read. Reload the page and try again.")).toBeInTheDocument()
    expect(actions.correct).not.toHaveBeenCalled()
  })

  it("shows the warning first when Save is pressed before the read had answered for this pick", async () => {
    actions.outlook.mockResolvedValueOnce(null).mockResolvedValue(MOVES)
    const user = userEvent.setup()
    sheet()
    await pickGirl(user)
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByText("This moves her out of FORM 1 B (Boys).")).toBeInTheDocument()
    expect(actions.correct).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(actions.correct).toHaveBeenCalledWith("lead-1", "Girl"))
  })

  it("before streams are on the read says nothing moves, and Save goes ahead", async () => {
    actions.outlook.mockResolvedValue(NO_MOVE)
    const user = userEvent.setup()
    sheet()
    await pickGirl(user)
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(actions.correct).toHaveBeenCalledWith("lead-1", "Girl"))
    expect(actions.outlook).toHaveBeenCalledWith("lead-1", "Girl")
  })
})

describe("GenderSheet while saving", () => {
  it("keeps the tiles still until the save answers", async () => {
    let finish: (value: unknown) => void = () => {}
    actions.correct.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    actions.outlook.mockResolvedValue(NO_MOVE)
    const user = userEvent.setup()
    sheet()
    await pickGirl(user)
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.getByRole("radio", { name: "Boy" })).toBeDisabled())
    finish({ status: "saved" })
    await waitFor(() => expect(actions.correct).toHaveBeenCalledWith("lead-1", "Girl"))
  })
})

describe("GenderSheet and late replies", () => {
  it("drops a read sent before the sheet was closed and opened again", async () => {
    let early: (value: unknown) => void = () => {}
    actions.outlook.mockReturnValueOnce(new Promise((resolve) => (early = resolve))).mockResolvedValue(MOVES)
    const user = userEvent.setup()
    sheet()
    await pickGirl(user)
    await user.click(screen.getByRole("button", { name: "Close" }))
    await pickGirl(user)
    expect(await screen.findByText("This moves her out of FORM 1 B (Boys).")).toBeInTheDocument()
    // The first reply, from before the sheet closed, says nothing moves.
    early(NO_MOVE)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByText("This moves her out of FORM 1 B (Boys).")).toBeInTheDocument()
  })

  it("lets Save go ahead on the fresh read while one from before the sheet was opened again is still out", async () => {
    let early: (value: unknown) => void = () => {}
    actions.outlook.mockReturnValueOnce(new Promise((resolve) => (early = resolve))).mockResolvedValue(NO_MOVE)
    const user = userEvent.setup()
    sheet()
    await pickGirl(user)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Close" }))
    await pickGirl(user)
    // The first read has still not answered.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled())
    await user.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(actions.correct).toHaveBeenCalledWith("lead-1", "Girl"))
    early(NO_MOVE)
  })

  it("stops waiting for a read when the answer on file is picked again", async () => {
    actions.outlook.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    sheet()
    await pickGirl(user)
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    await user.click(screen.getByRole("radio", { name: "Boy" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled())
  })
})
