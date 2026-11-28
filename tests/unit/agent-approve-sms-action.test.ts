import { beforeEach, describe, expect, it, vi } from "vitest"

// Approve with no email (the approval SMS): what the Manager hears, with the
// database and the SMS service stubbed.

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/utils/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }))
vi.mock("@/utils/supabase/admin", () => ({ agentInviteSender: vi.fn() }))
vi.mock("@/app/staff/agents/invite-link", () => ({ agentSetPasswordUrl: vi.fn(async () => "https://agents.example.test/set-password") }))
vi.mock("@/lib/services/staff-auth", () => ({ requirePermission: vi.fn(async () => ({ ok: true, data: null })) }))
vi.mock("@/lib/services/marketing-agents", () => ({ approveAgent: vi.fn(async () => ({ ok: true, data: null })) }))
vi.mock("@/lib/services/sms", () => ({ smsSender: vi.fn() }))
vi.mock("@/utils/supabase/sms", () => ({ smsClient: vi.fn() }))
vi.mock("@/lib/services/agent-approval-sms", () => ({ sendApprovalSms: vi.fn() }))
vi.mock("@/lib/services/agent-invites", () => ({ sendAgentInvite: vi.fn(), getAgentInvites: vi.fn() }))

import { approveMarketingAgent } from "@/app/staff/agents/actions"
import { sendApprovalSms } from "@/lib/services/agent-approval-sms"
import { getAgentInvites } from "@/lib/services/agent-invites"
import { smsClient } from "@/utils/supabase/sms"

const ID = "a4a4a4a4-0000-4000-8000-000000000999"
const AGENT = { fullName: "Neema Juma", code: "NEJ-999" }

function note(joined: boolean) {
  return { ok: true as const, data: new Map([[ID, { email: null, state: null, sentAt: null, lastAttempt: null, joined }]]) }
}

beforeEach(() => vi.clearAllMocks())

describe("approving an agent with no email", () => {
  it("texts one who signed up by mobile and says so", async () => {
    vi.mocked(smsClient).mockReturnValue({} as never)
    vi.mocked(sendApprovalSms).mockResolvedValue({ ok: true, data: { kind: "sent", phone: "+255712345123" } })

    expect(await approveMarketingAgent(ID, AGENT, null)).toEqual({
      status: "approved",
      message: "Neema Juma (NEJ-999) is Approved. SMS sent to +255 712 345 123.",
      inviteSent: false,
    })
  })

  it("warns the Manager when the server can't send SMS and the agent signs in by mobile", async () => {
    vi.mocked(smsClient).mockReturnValue(null)
    vi.mocked(getAgentInvites).mockResolvedValue(note(true))

    expect(await approveMarketingAgent(ID, AGENT, null)).toEqual({
      status: "approved",
      message: "Approved. SMS not sent: the SMS service gave an error. Tell them yourself, by WhatsApp or a call.",
      inviteSent: false,
      smsMissed: true,
    })
    expect(sendApprovalSms).not.toHaveBeenCalled()
  })

  it("words an agent with no login as before when the server can't send SMS", async () => {
    vi.mocked(smsClient).mockReturnValue(null)
    vi.mocked(getAgentInvites).mockResolvedValue(note(false))

    expect(await approveMarketingAgent(ID, AGENT, null)).toEqual({
      status: "approved",
      message: "Neema Juma (NEJ-999) is Approved. Add their email to send the invite.",
      inviteSent: false,
    })
  })
})
