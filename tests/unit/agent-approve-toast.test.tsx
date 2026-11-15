import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Approving an agent confirms with a toast (#401): news when the invite
// went, a warning when the agent is Approved but the invite email did not go.

const { approve, toast } = vi.hoisted(() => ({ approve: vi.fn(), toast: vi.fn() }))
vi.mock("@/app/staff/agents/actions", () => ({ approveMarketingAgent: approve }))
vi.mock("@/components/kit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/kit")>()), toast }))

import { ApproveAgent } from "@/app/staff/agents/approve-agent"

const AGENT = { id: "a4a4a4a4-0000-4000-8000-000000000999", fullName: "Neema Juma", code: "NEJ-999" }

async function approveAgent() {
  render(<ApproveAgent agent={AGENT} email="neema@example.com" />)
  fireEvent.click(screen.getByRole("button", { name: "Approve Neema Juma" }))
  fireEvent.click(await screen.findByRole("button", { name: "Approve NEJ-999" }))
  await waitFor(() => expect(toast).toHaveBeenCalledOnce())
}

beforeEach(() => {
  approve.mockReset()
  toast.mockReset()
})

describe("Approve's toast", () => {
  it("is news when the invite went", async () => {
    approve.mockResolvedValue({ status: "approved", inviteSent: true, message: "Approved. Invite sent to neema@example.com." })
    await approveAgent()
    expect(toast).toHaveBeenCalledWith("Approved. Invite sent to neema@example.com.", { tone: "info" })
  })

  it("is a warning when the agent is Approved but the invite did not go", async () => {
    approve.mockResolvedValue({ status: "approved", inviteSent: false, message: "Approved. Send the invite again." })
    await approveAgent()
    expect(toast).toHaveBeenCalledWith("Approved. Send the invite again.", { tone: "wait" })
  })
})
