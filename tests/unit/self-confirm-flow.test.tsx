import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  sendSelfConfirmNumber: vi.fn(),
  checkSelfConfirmNumber: vi.fn(),
  sendSelfConfirmEmail: vi.fn(),
  finishSelfConfirm: vi.fn(async () => null),
  setNewAgentEmailAction: vi.fn(),
}))
vi.mock("@/app/discount-code/self-confirm-actions", () => actions)
vi.mock("@/components/turnstile-widget", () => ({ TurnstileWidget: () => null }))

import { FLOW_KEY } from "@/app/discount-code/flow-state"
import { SelfConfirmFlow } from "@/app/discount-code/self-confirm-flow"

// Self-confirm's steps on the page (#503 slice 3), with the server actions
// replaced: the choice, the SMS boxes into the password, and email instead.

const STARTED = {
  status: "self-confirm" as const,
  attempt: "6f1c2c1e-1b2d-4c3e-9f4a-5b6c7d8e9f01",
  mobileOnRecord: true,
  typedMatches: true,
  canText: true,
  emailOnRecord: false,
  emailOpen: true,
  email: "neema@mfano.com",
  phone: "0712345123",
}

beforeEach(() => {
  Object.values(actions).forEach((fn) => fn.mockReset())
})

describe("SelfConfirmFlow", () => {
  it("by mobile: the number to the mobile on record, then the password", async () => {
    actions.sendSelfConfirmNumber.mockResolvedValue({ status: "sent", masked: "07•• ••• 123", onRecord: true })
    actions.checkSelfConfirmNumber.mockResolvedValue({ status: "right", phone: "+255712345123" })
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={STARTED} onChangeEmail={() => {}} />)

    await userEvent.click(screen.getByRole("radio", { name: /Kwa namba ya simu/ }))
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    expect(await screen.findByRole("heading", { name: "Angalia SMS yako" })).toBeInTheDocument()
    expect(screen.getByText("07•• ••• 123")).toBeInTheDocument()
    expect(actions.sendSelfConfirmNumber).toHaveBeenCalledWith(STARTED.attempt)

    await userEvent.click(screen.getByRole("textbox", { name: "Tarakimu 1 kati ya 6" }))
    await userEvent.paste("482913")
    expect(await screen.findByRole("heading", { name: "Weka nenosiri lako" }, { timeout: 3000 })).toBeInTheDocument()
    expect(actions.checkSelfConfirmNumber).toHaveBeenCalledWith(STARTED.attempt, "482913")
    expect(document.querySelector('input[name="phone"]')).toHaveValue("+255712345123")
  })

  // From Send on there is nothing to go back to (owner, #503 slice 4d-c): the
  // choice, the SMS boxes and Set password have no progress bar, section name or Start over.
  it("shows no progress bar on the choice, the SMS boxes or Set password", async () => {
    actions.sendSelfConfirmNumber.mockResolvedValue({ status: "sent", masked: "07•• ••• 123", onRecord: true })
    actions.checkSelfConfirmNumber.mockResolvedValue({ status: "right", phone: "+255712345123" })
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={STARTED} onChangeEmail={() => {}} />)
    const noBar = () => {
      expect(document.querySelector(".gf-bar-row")).toBeNull()
      expect(screen.queryByRole("button", { name: "Anza upya" })).not.toBeInTheDocument()
    }
    noBar()
    await userEvent.click(screen.getByRole("radio", { name: /Kwa namba ya simu/ }))
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    await screen.findByRole("heading", { name: "Angalia SMS yako" })
    noBar()
    await userEvent.click(screen.getByRole("textbox", { name: "Tarakimu 1 kati ya 6" }))
    await userEvent.paste("482913")
    await screen.findByRole("heading", { name: "Weka nenosiri lako" }, { timeout: 3000 })
    noBar()
  })

  it("a wrong number says so with the tries left", async () => {
    actions.sendSelfConfirmNumber.mockResolvedValue({ status: "sent", masked: "07•• ••• 123", onRecord: true })
    actions.checkSelfConfirmNumber.mockResolvedValue({ status: "wrong", triesLeft: 4 })
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={STARTED} onChangeEmail={() => {}} />)
    await userEvent.click(screen.getByRole("radio", { name: /Kwa namba ya simu/ }))
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    await screen.findByRole("heading", { name: "Angalia SMS yako" })
    await userEvent.click(screen.getByRole("textbox", { name: "Tarakimu 1 kati ya 6" }))
    await userEvent.paste("000000")
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Namba hii si sahihi. Ihakiki, kisha ujaribu tena. Umebakiwa na majaribio 4"), { timeout: 3000 })
  })

  it("no SMS possible: the choice again with email only, and email goes when the agent chooses it", async () => {
    actions.sendSelfConfirmNumber.mockResolvedValue({ status: "no-sms" })
    actions.sendSelfConfirmEmail.mockResolvedValue({ status: "sent", email: "neema@mfano.com" })
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={STARTED} onChangeEmail={() => {}} />)
    await userEvent.click(screen.getByRole("radio", { name: /Kwa namba ya simu/ }))
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    await waitFor(() => expect(screen.queryByRole("radio", { name: /Kwa namba ya simu/ })).toBeNull())
    expect(actions.sendSelfConfirmEmail).not.toHaveBeenCalled()
    expect(screen.getByRole("radio", { name: /Kwa barua pepe/ })).toBeChecked()
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    expect(await screen.findByRole("heading", { name: "Angalia barua pepe yako" })).toBeInTheDocument()
    expect(actions.sendSelfConfirmEmail).toHaveBeenCalledWith(STARTED.attempt, "neema@mfano.com")
  })

  it("a record with no mobile and none typed offers email only", () => {
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={{ ...STARTED, mobileOnRecord: false, canText: false }} onChangeEmail={() => {}} />)
    expect(screen.queryByRole("radio", { name: /Kwa namba ya simu/ })).toBeNull()
    expect(screen.getByRole("radio", { name: /Kwa barua pepe/ })).toBeChecked()
  })

  it("with email closed on the code, only the mobile is offered, and no email way out", async () => {
    actions.sendSelfConfirmNumber.mockResolvedValue({ status: "sent", masked: "07•• ••• 123", onRecord: true })
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={{ ...STARTED, emailOpen: false }} onChangeEmail={() => {}} />)
    expect(screen.queryByRole("radio", { name: /Kwa barua pepe/ })).toBeNull()
    expect(screen.getByRole("radio", { name: /Kwa namba ya simu/ })).toBeChecked()
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    await screen.findByRole("heading", { name: "Angalia SMS yako" })
    await userEvent.click(screen.getByRole("button", { name: "Hujapata SMS?" }))
    expect(screen.queryByRole("button", { name: "Tumia barua pepe" })).toBeNull()
  })

  it("a mobile that already signs in elsewhere is offered email (E8)", async () => {
    actions.sendSelfConfirmNumber.mockResolvedValue({ status: "sent", masked: "07•• ••• 123", onRecord: true })
    actions.checkSelfConfirmNumber.mockResolvedValue({ status: "mobile-used" })
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={STARTED} onChangeEmail={() => {}} />)
    await userEvent.click(screen.getByRole("radio", { name: /Kwa namba ya simu/ }))
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    await screen.findByRole("heading", { name: "Angalia SMS yako" })
    await userEvent.click(screen.getByRole("textbox", { name: "Tarakimu 1 kati ya 6" }))
    await userEvent.paste("482913")
    expect(await screen.findByRole("heading", { name: "Namba hii tayari inatumika" }, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Tumia barua pepe" })).toBeInTheDocument()
  })
})

// Self-confirm's order (#503 slice 4d-b): the email is asked here, on the email path.
describe("SelfConfirmFlow, email asked on its path", () => {
  const NEW_AGENT = { ...STARTED, mobileOnRecord: true, emailOnRecord: false, email: "", newAgent: true, code: "RAJ-124" }

  it("a new agent by email: the email question, then today's finish with the waiting code", async () => {
    actions.setNewAgentEmailAction.mockResolvedValue({ status: "registered", code: "RAJ-124", link: "https://alrahmah.example/apply?ref=RAJ-124", email: "baraka@mfano.com", discount: null })
    const onRegistered = vi.fn()
    const onFinished = vi.fn()
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={NEW_AGENT} onRegistered={onRegistered} onFinished={onFinished} />)
    await userEvent.click(screen.getByRole("radio", { name: /Kwa barua pepe/ }))
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    const box = await screen.findByLabelText("Barua pepe yako?")
    expect(actions.sendSelfConfirmEmail).not.toHaveBeenCalled()
    await userEvent.type(box, "baraka@mfano.com")
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(expect.objectContaining({ status: "registered", code: "RAJ-124", email: "baraka@mfano.com" })))
    expect(actions.setNewAgentEmailAction).toHaveBeenCalledWith(NEW_AGENT.attempt, "baraka@mfano.com")
    expect(onFinished).toHaveBeenCalled()
  })

  it("a new agent's email someone else uses says so and keeps the question", async () => {
    actions.setNewAgentEmailAction.mockResolvedValue({ status: "email-unusable" })
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={NEW_AGENT} />)
    await userEvent.click(screen.getByRole("radio", { name: /Kwa barua pepe/ }))
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    await userEvent.type(await screen.findByLabelText("Barua pepe yako?"), "taken@mfano.com")
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Barua pepe hii haiwezi kutumika")
    expect(screen.getByLabelText("Barua pepe yako?")).toHaveValue("taken@mfano.com")
  })

  it("a code holder with no email on record and none typed is asked for it, then today's invite goes", async () => {
    actions.sendSelfConfirmEmail.mockResolvedValue({ status: "sent", email: "neema@mfano.com" })
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={{ ...STARTED, email: "" }} />)
    await userEvent.click(screen.getByRole("radio", { name: /Kwa barua pepe/ }))
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    await userEvent.type(await screen.findByLabelText("Barua pepe yako?"), "neema@mfano.com")
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    expect(await screen.findByRole("heading", { name: "Angalia barua pepe yako" })).toBeInTheDocument()
    expect(actions.sendSelfConfirmEmail).toHaveBeenCalledWith(STARTED.attempt, "neema@mfano.com")
    // Wrong email? Change it brings the question back here.
    await userEvent.click(screen.getByRole("button", { name: "Barua pepe si sahihi? Ibadilishe" }))
    expect(await screen.findByLabelText("Barua pepe yako?")).toHaveValue("neema@mfano.com")
  })

  // Each step as the approved prototype draws it (owner, prototype v5).
  it("puts the step's icon on top and the office's number at the foot", () => {
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={STARTED} />)
    expect(document.querySelector("[data-step-icon]")).not.toBeNull()
    expect(screen.getByText("Una swali? Piga simu ofisi ya udahili")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "+255 673 526 644" })).toHaveAttribute("href", "tel:+255673526644")
  })

  it("Set password names the mobile it signs in with, and the rule sits under both boxes", () => {
    render(<SelfConfirmFlow language="en" officePhone="+255 673 526 644" startedAt={Date.now()} started={STARTED} initialStep={{ at: "password", phone: "+255712345123" }} />)
    expect(screen.getByRole("heading", { name: "Set your password" })).toBeInTheDocument()
    expect(screen.getByText(/You'll sign in with/)).toHaveTextContent("You'll sign in with 0712345123")
    const rule = screen.getByText("At least 6 characters.")
    const confirm = screen.getByLabelText("Repeat new password")
    expect(confirm.compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("comes back to the step it was on after a reload, and keeps that step in the tab", () => {
    window.sessionStorage.clear()
    const step = { at: "sms" as const, masked: "07•• ••• 123", onRecord: true, sentAt: Date.now() }
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={STARTED} initialStep={step} />)
    expect(screen.getByRole("heading", { name: "Angalia SMS yako" })).toBeInTheDocument()
    expect(JSON.parse(window.sessionStorage.getItem(FLOW_KEY) ?? "null")).toMatchObject({ step, started: { attempt: STARTED.attempt } })
  })

  it("forgets the kept step once the email is on its way", async () => {
    window.sessionStorage.clear()
    actions.sendSelfConfirmEmail.mockResolvedValue({ status: "sent", email: "neema@mfano.com" })
    render(<SelfConfirmFlow language="sw" officePhone="+255 673 526 644" startedAt={Date.now()} started={STARTED} />)
    expect(window.sessionStorage.getItem(FLOW_KEY)).not.toBeNull()
    await userEvent.click(screen.getByRole("radio", { name: /Kwa barua pepe/ }))
    await userEvent.click(screen.getByRole("button", { name: "Endelea" }))
    await screen.findByRole("heading", { name: "Angalia barua pepe yako" })
    expect(window.sessionStorage.getItem(FLOW_KEY)).toBeNull()
  })
})
