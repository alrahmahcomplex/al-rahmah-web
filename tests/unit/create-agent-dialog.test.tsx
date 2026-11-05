import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  check: vi.fn(),
  create: vi.fn(),
  preview: vi.fn(),
  recreate: vi.fn(),
}))
vi.mock("@/app/staff/agents/actions", () => ({
  checkNewMarketingAgent: actions.check,
  createMarketingAgent: actions.create,
  readRecreatePreview: actions.preview,
  recreateMarketingAgent: actions.recreate,
}))

import { CreateAgent } from "@/app/staff/agents/create-agent"
import { RecreateAgent } from "@/app/staff/agents/recreate-agent"

// The Add agent and Recreate dialogs, with the server actions stubbed: what
// the Manager confirmed is what gets saved.

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

const READY = {
  status: "ready",
  check: {
    kind: "ready",
    fullName: "Neema Asha Create",
    phone: "+255700000401",
    whatsapp: null,
    email: null,
    code: null,
    codePrefix: "NAC",
  },
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
  // jsdom has no layout; the fields scroll themselves into view on focus.
  Element.prototype.scrollIntoView = vi.fn()
})

describe("Add agent", () => {
  it("locks the fields while checking, and saves exactly the details it checked", async () => {
    const user = userEvent.setup()
    const checking = deferred<typeof READY>()
    actions.check.mockReturnValue(checking.promise)
    actions.create.mockResolvedValue({ status: "created", message: "Created" })
    render(<CreateAgent />)

    await user.click(screen.getByRole("button", { name: "Add agent" }))
    await user.type(screen.getByLabelText(/Full name/), "Neema Asha Create")
    await user.type(screen.getByLabelText(/Mobile/), "0700000401")
    await user.click(screen.getByRole("button", { name: "Check details" }))

    const checked = { fullName: "Neema Asha Create", phone: "0700000401", whatsapp: "", email: "", code: "" }
    expect(actions.check).toHaveBeenCalledWith(checked)
    // Typing while the check runs changes nothing.
    expect(screen.getByLabelText(/Full name/)).toBeDisabled()
    expect(screen.getByLabelText(/Mobile/)).toBeDisabled()
    await user.type(screen.getByLabelText(/Mobile/), "9")

    checking.resolve(READY)
    await user.click(await screen.findByRole("button", { name: "Create agent" }))
    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1))
    expect(actions.create).toHaveBeenCalledWith(checked)
  })

  it("after Edit, the confirmation shows and saves the new details only once they are checked again", async () => {
    const user = userEvent.setup()
    actions.check.mockResolvedValue(READY)
    actions.create.mockResolvedValue({ status: "created", message: "Created" })
    render(<CreateAgent />)

    await user.click(screen.getByRole("button", { name: "Add agent" }))
    await user.type(screen.getByLabelText(/Full name/), "Neema Asha Create")
    await user.type(screen.getByLabelText(/Mobile/), "0700000401")
    await user.click(screen.getByRole("button", { name: "Check details" }))
    await user.click(await screen.findByRole("button", { name: "Edit" }))

    await user.clear(screen.getByLabelText(/Mobile/))
    await user.type(screen.getByLabelText(/Mobile/), "0700000402")
    expect(screen.queryByRole("button", { name: "Create agent" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Check details" }))
    await user.click(await screen.findByRole("button", { name: "Create agent" }))

    await waitFor(() => expect(actions.create).toHaveBeenCalledTimes(1))
    expect(actions.create).toHaveBeenCalledWith(expect.objectContaining({ phone: "0700000402" }))
    expect(actions.check).toHaveBeenLastCalledWith(expect.objectContaining({ phone: "0700000402" }))
  })
})

describe("Recreate", () => {
  it("locks the details while saving, so the fields show what is being saved", async () => {
    const user = userEvent.setup()
    actions.preview.mockResolvedValue({
      status: "ready",
      preview: {
        agent: { id: "agent-1", fullName: "Baraka Old", phone: "+255700000501", whatsapp: null, email: null, code: "TBR-12345", retired: false },
        studentCount: 0,
        families: [],
      },
    })
    const saving = deferred<{ status: "recreated"; message: string }>()
    actions.recreate.mockReturnValue(saving.promise)
    render(<RecreateAgent agent={{ id: "agent-1", fullName: "Baraka Old", code: "TBR-12345" }} />)

    await user.click(screen.getByRole("button", { name: "Recreate Baraka Old" }))
    await screen.findByDisplayValue("Baraka Old")
    await user.click(screen.getByRole("checkbox"))
    await user.type(screen.getByLabelText("Reason"), "Name spelled wrong")
    await user.click(screen.getByRole("button", { name: "Recreate TBR-12345" }))

    expect(actions.recreate).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ fullName: "Baraka Old", phone: "+255700000501" }),
      "Name spelled wrong",
    )
    expect(screen.getByLabelText(/Full name/)).toBeDisabled()
    expect(screen.getByLabelText("Reason")).toBeDisabled()
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-disabled", "true")
    saving.resolve({ status: "recreated", message: "Recreated" })
  })
})
