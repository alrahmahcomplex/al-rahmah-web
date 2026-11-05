import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// The Agents screen's row actions that depend on the agent's email (#191),
// with the Server Actions stubbed. When the emails couldn't be read, nothing
// may act on a missing email: Approve would skip the invite, and Send or
// Edit would work from a blank address.

vi.mock("@/app/staff/agents/actions", () => ({ approveMarketingAgent: vi.fn() }))
vi.mock("@/app/staff/agents/invite-actions", () => ({ sendMarketingAgentInvite: vi.fn(), saveMarketingAgentEmail: vi.fn() }))

import { AgentInviteActions } from "@/app/staff/agents/agent-invite"
import { ApproveAgent } from "@/app/staff/agents/approve-agent"

const AGENT = { id: "a4a4a4a4-0000-4000-8000-000000000999", fullName: "Neema Juma", code: "NEJ-999" }

describe("while the agents' emails couldn't be loaded", () => {
  it("Approve is shown but can't be pressed", () => {
    render(<ApproveAgent agent={AGENT} email={null} emailUnknown />)

    expect(screen.getByRole("button", { name: "Approve Neema Juma" })).toBeDisabled()
  })

  it("no invite or email action is offered", () => {
    render(<AgentInviteActions agent={AGENT} email={null} state={null} everSent={false} emailUnknown />)

    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})

describe("once the emails are loaded", () => {
  it("Approve and Add email are offered", () => {
    render(
      <>
        <ApproveAgent agent={AGENT} email={null} />
        <AgentInviteActions agent={AGENT} email={null} state="no_email" everSent={false} />
      </>,
    )

    expect(screen.getByRole("button", { name: "Approve Neema Juma" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Add email for Neema Juma" })).toBeEnabled()
  })
})
