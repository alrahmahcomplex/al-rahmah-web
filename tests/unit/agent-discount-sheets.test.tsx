import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  agentImpact: vi.fn(),
  saveAgent: vi.fn(),
  standardImpact: vi.fn(),
  saveStandard: vi.fn(),
  checkPromo: vi.fn(),
  createPromo: vi.fn(),
  promoImpact: vi.fn(),
  updatePromo: vi.fn(),
  changePromoState: vi.fn(),
}))
vi.mock("@/app/staff/agents/discount-actions", () => ({
  readAgentDiscountImpact: actions.agentImpact,
  saveAgentDiscount: actions.saveAgent,
  readStandardDiscountImpact: actions.standardImpact,
  saveStandardDiscount: actions.saveStandard,
}))
vi.mock("@/app/staff/promo-codes/actions", () => ({
  checkPromoCode: actions.checkPromo,
  createPromo: actions.createPromo,
  readPromoImpact: actions.promoImpact,
  updatePromo: actions.updatePromo,
  changePromoState: actions.changePromoState,
}))

import { AgentDiscount, type DiscountAgent } from "@/app/staff/agents/discount-sheet"
import { StandardDiscount } from "@/app/staff/agents/standard-discount-sheet"
import { PromoCodes } from "@/app/staff/promo-codes/promo-codes"
import { PromoSheet } from "@/app/staff/promo-codes/promo-sheet"
import type { PromoCode } from "@/lib/services/promo-codes"

// The discount sheets in the kit (#330), with the server actions stubbed:
// the amount and the choice typed are what reach the action, and a role
// without discount_codes.manage gets no way to change them.

const AGENT: DiscountAgent = {
  id: "agent-1",
  fullName: "Neema Asha Sheet",
  code: "NAS-101",
  phone: "+255 700 000 401",
  status: { label: "Approved", tone: "good" },
  studentCount: 2,
  interviewDiscount: null,
  retired: false,
}

const PROMO: PromoCode = {
  id: "promo-1",
  code: "INSTA26",
  name: "Instagram ad",
  note: null,
  amount: 20_000,
  endsOn: null,
  state: "active",
  effectiveState: "active",
  studentCount: 0,
  unpaidCount: 0,
  createdAt: "2026-11-01T08:00:00Z",
  updatedAt: "2026-11-01T08:00:00Z",
}

const NO_FAMILIES = { status: "ready", families: [] }
const SAVED = { status: "saved", message: "Saved." }

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
  actions.agentImpact.mockResolvedValue(NO_FAMILIES)
  actions.standardImpact.mockResolvedValue(NO_FAMILIES)
  actions.promoImpact.mockResolvedValue(NO_FAMILIES)
  actions.checkPromo.mockResolvedValue({ status: "available", code: "NEWCODE" })
  for (const save of [actions.saveAgent, actions.saveStandard, actions.createPromo, actions.updatePromo]) save.mockResolvedValue(SAVED)
  Element.prototype.scrollIntoView = vi.fn()
})

async function replace(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field)
  await user.type(field, text)
}

describe("an agent's discount sheet", () => {
  it("sends the own amount typed, as a number, with the reason", async () => {
    const user = userEvent.setup()
    render(<AgentDiscount agent={AGENT} standard={20_000} canManage />)
    await user.click(screen.getByRole("button", { name: `Interview discount for ${AGENT.fullName}: TZS 20,000, standard` }))

    const sheet = await screen.findByRole("dialog", { name: AGENT.fullName })
    await user.click(within(sheet).getByRole("radio", { name: /Own amount/ }))
    await replace(user, within(sheet).getByLabelText("Amount off the TZS 50,000 fee"), "30000")
    await user.type(within(sheet).getByLabelText("Reason"), "Agreed with the Director")
    await user.click(within(sheet).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(actions.saveAgent).toHaveBeenCalledTimes(1))
    expect(actions.saveAgent).toHaveBeenCalledWith(AGENT.id, 30_000, "Agreed with the Director", { code: AGENT.code, standard: 20_000 })
  })

  it("sends null when an agent with an own amount goes back to the standard", async () => {
    const user = userEvent.setup()
    render(<AgentDiscount agent={{ ...AGENT, interviewDiscount: 30_000 }} standard={20_000} canManage />)
    await user.click(screen.getByRole("button", { name: /^Interview discount for/ }))

    const sheet = await screen.findByRole("dialog", { name: AGENT.fullName })
    expect(within(sheet).getByRole("radio", { name: /Own amount/ })).toBeChecked()
    await user.click(within(sheet).getByRole("radio", { name: /Standard, TZS 20,000 off/ }))
    await user.type(within(sheet).getByLabelText("Reason"), "Back to the standard")
    await user.click(within(sheet).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(actions.saveAgent).toHaveBeenCalledTimes(1))
    expect(actions.saveAgent).toHaveBeenCalledWith(AGENT.id, null, "Back to the standard", { code: AGENT.code, standard: 20_000 })
  })

  it("keeps the two choices' names and values", async () => {
    const user = userEvent.setup()
    render(<AgentDiscount agent={AGENT} standard={20_000} canManage />)
    await user.click(screen.getByRole("button", { name: /^Interview discount for/ }))
    const radios = within(await screen.findByRole("dialog", { name: AGENT.fullName })).getAllByRole("radio")
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(["standard", "own"])
    expect(new Set(radios.map((radio) => (radio as HTMLInputElement).name)).size).toBe(1)
    expect(radios[0]).toBeChecked()
  })

  it("shows the facts only to a role that cannot set discounts", async () => {
    const user = userEvent.setup()
    render(<AgentDiscount agent={AGENT} standard={20_000} canManage={false} />)
    await user.click(screen.getByRole("button", { name: /^Interview discount for/ }))

    const sheet = await screen.findByRole("dialog", { name: AGENT.fullName })
    expect(within(sheet).queryAllByRole("radio")).toHaveLength(0)
    expect(within(sheet).queryByRole("button", { name: "Save" })).toBeNull()
    expect(within(sheet).queryAllByRole("textbox")).toHaveLength(0)
  })
})

describe("the standard discount sheet", () => {
  it("sends the amount typed, as a number, with the reason", async () => {
    const user = userEvent.setup()
    render(<StandardDiscount amount={20_000} agentsOnStandard={4} canManage />)
    await user.click(screen.getByRole("button", { name: "Change the standard discount" }))

    const sheet = await screen.findByRole("dialog", { name: "Standard discount" })
    await replace(user, within(sheet).getByLabelText("Amount off the TZS 50,000 interview fee"), "15000")
    await user.type(within(sheet).getByLabelText("Reason"), "New term")
    await user.click(within(sheet).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(actions.saveStandard).toHaveBeenCalledTimes(1))
    expect(actions.saveStandard).toHaveBeenCalledWith(15_000, "New term")
  })

  it("has no Change for a role that cannot set discounts", () => {
    render(<StandardDiscount amount={20_000} agentsOnStandard={4} canManage={false} />)
    expect(screen.queryByRole("button", { name: "Change the standard discount" })).toBeNull()
  })
})

function promoSheet(promo: PromoCode | null, canManage = true) {
  return (
    <PromoSheet
      open
      onOpenChange={() => {}}
      promo={promo}
      highestAgentAmount={30_000}
      canManage={canManage}
      statePending={false}
      stateRefusal={null}
      onChangeState={() => {}}
      onSaved={() => {}}
    />
  )
}

describe("the Promo code sheet", () => {
  it("creates the code with the name, code and amount typed", async () => {
    const user = userEvent.setup()
    render(promoSheet(null))
    const sheet = await screen.findByRole("dialog", { name: "New Promo code" })
    await user.type(within(sheet).getByLabelText("Name"), "Radio ad")
    await user.type(within(sheet).getByLabelText("Code parents type"), "newcode")
    await replace(user, within(sheet).getByLabelText("Amount off the TZS 50,000 fee"), "30000")
    await user.click(within(sheet).getByRole("button", { name: "Create code" }))

    await waitFor(() => expect(actions.createPromo).toHaveBeenCalledTimes(1))
    expect(actions.createPromo).toHaveBeenCalledWith({ name: "Radio ad", amount: 30_000, endsOn: null, note: null, code: "NEWCODE" })
  })

  it("saves a new amount and last day with the reason, against the code as it was", async () => {
    const user = userEvent.setup()
    render(promoSheet(PROMO))
    const sheet = await screen.findByRole("dialog", { name: PROMO.code })
    await replace(user, within(sheet).getByLabelText("Amount off the TZS 50,000 fee"), "22000")
    await user.click(within(sheet).getByText("More options"))
    await user.type(within(sheet).getByLabelText("Ends on"), "2026-12-31")
    await user.type(within(sheet).getByLabelText("Reason"), "Longer campaign")
    await user.click(within(sheet).getByRole("button", { name: "Save" }))

    await waitFor(() => expect(actions.updatePromo).toHaveBeenCalledTimes(1))
    expect(actions.updatePromo).toHaveBeenCalledWith(
      PROMO.id,
      { name: PROMO.name, amount: 22_000, endsOn: "2026-12-31", note: null },
      "Longer campaign",
      { code: PROMO.code, amount: PROMO.amount, endsOn: PROMO.endsOn },
    )
  })

  it("shows the facts only to a role that cannot set discounts", async () => {
    render(promoSheet(PROMO, false))
    const sheet = await screen.findByRole("dialog", { name: PROMO.code })
    expect(within(sheet).queryAllByRole("textbox")).toHaveLength(0)
    for (const name of ["Save", "Pause code", "End code"]) expect(within(sheet).queryByRole("button", { name })).toBeNull()
  })

  it("offers New Promo code only to a role that can set discounts", () => {
    const { rerender } = render(<PromoCodes codes={[PROMO]} highestAgentAmount={null} canManage={false} today="2026-11-12" />)
    expect(screen.queryByRole("button", { name: "New Promo code" })).toBeNull()
    rerender(<PromoCodes codes={[PROMO]} highestAgentAmount={null} canManage today="2026-11-12" />)
    expect(screen.getByRole("button", { name: "New Promo code" })).toBeInTheDocument()
  })

  it("opens a code's sheet from its row, named Open and the code (#343)", async () => {
    const user = userEvent.setup()
    render(<PromoCodes codes={[PROMO]} highestAgentAmount={null} canManage today="2026-11-12" />)
    const row = screen.getByRole("row", { name: `Open ${PROMO.code}` })
    row.focus()
    await user.keyboard("{Enter}")
    expect(await screen.findByRole("dialog", { name: PROMO.code })).toBeInTheDocument()
  })
})
