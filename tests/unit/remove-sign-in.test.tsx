import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  readAgentSignIn: vi.fn(),
  removeSignIn: vi.fn(),
}))
vi.mock("@/app/staff/agents/sign-in-actions", () => actions)

import { RemoveSignIn } from "@/app/staff/agents/remove-sign-in"

// Remove this sign-in on the Agents screen (#503, prototype v58 R1 and R2),
// with the server actions replaced.

const AGENT = { id: "6f1c2c1e-1b2d-4c3e-9f4a-5b6c7d8e9f01", fullName: "Neema Simu Juma", code: "NSJ-101" }

beforeEach(() => {
  Object.values(actions).forEach((fn) => fn.mockReset())
  actions.readAgentSignIn.mockResolvedValue({ status: "ready", login: "9f1c2c1e-1b2d-4c3e-9f4a-5b6c7d8e9f02", signedInWith: "+255712345123", joinedAt: "2026-11-21T07:42:00Z" })
})

async function openSheet() {
  render(<RemoveSignIn agent={AGENT} />)
  await userEvent.click(screen.getByRole("button", { name: "More actions for Neema Simu Juma" }))
  await userEvent.click(await screen.findByRole("button", { name: "Remove this sign-in" }))
  return screen.findByRole("dialog", { name: "Remove this sign-in?" })
}

describe("RemoveSignIn", () => {
  it("shows what the agent signs in with and since when, the warning, and the tick on by default", async () => {
    const sheet = await openSheet()
    expect(await screen.findByText("+255712345123")).toBeInTheDocument()
    expect(screen.getByText(/21 Nov 2026/)).toBeInTheDocument()
    expect(sheet).toHaveTextContent('This person is signed out everywhere, and the code goes back to "Not joined".')
    expect(screen.getByRole("checkbox", { name: /Close email self-confirm on this code/ })).toBeChecked()
  })

  it("removes with the tick as set, then closes", async () => {
    actions.removeSignIn.mockResolvedValue({ status: "removed", message: "Sign-in removed." })
    await openSheet()
    await screen.findByText("+255712345123")
    await userEvent.click(screen.getByRole("checkbox", { name: /Close email self-confirm on this code/ }))
    const buttons = screen.getAllByRole("button", { name: "Remove this sign-in" })
    await userEvent.click(buttons[buttons.length - 1])
    expect(actions.removeSignIn).toHaveBeenCalledWith(AGENT.id, false, "9f1c2c1e-1b2d-4c3e-9f4a-5b6c7d8e9f02")
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove this sign-in?" })).toBeNull())
  })

  it("keeps the sheet open with the reason when the removal is refused", async () => {
    actions.removeSignIn.mockResolvedValue({ status: "refused", message: "This agent has no sign-in to remove. Reload the page to see them as they are now." })
    await openSheet()
    await screen.findByText("+255712345123")
    const buttons = screen.getAllByRole("button", { name: "Remove this sign-in" })
    await userEvent.click(buttons[buttons.length - 1])
    expect(await screen.findByRole("alert")).toHaveTextContent("This agent has no sign-in to remove.")
    expect(actions.removeSignIn).toHaveBeenCalledWith(AGENT.id, true, "9f1c2c1e-1b2d-4c3e-9f4a-5b6c7d8e9f02")
  })
})
