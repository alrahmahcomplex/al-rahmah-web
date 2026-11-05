import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ whatsapp: vi.fn(), sms: vi.fn() }))
vi.mock("@/app/staff/leads/[id]/result-release-actions", () => ({
  sendResultByWhatsApp: actions.whatsapp,
  sendResultBySms: actions.sms,
}))

import { SendResult } from "@/app/staff/leads/[id]/result-release-send"

// The Result release section's send buttons, with the server actions stubbed.

const tab = { opener: {} as unknown, closed: false, close: vi.fn(), location: { href: "" } }

afterEach(() => {
  delete (Element.prototype as Partial<Element>).getAnimations
})

beforeEach(() => {
  actions.whatsapp.mockReset()
  actions.sms.mockReset()
  tab.close.mockReset()
  tab.location.href = ""
  vi.spyOn(window, "open").mockImplementation(() => tab as unknown as Window)
})

function sendResult({ seenReleases, repeat }: { seenReleases: number; repeat: string | null }) {
  return render(
    <SendResult
      leadId="lead-1"
      interviewId="interview-1"
      smsNote={null}
      seenReleases={seenReleases}
      repeat={repeat}
      whatsappPreview={<p>Preview</p>}
    />,
  )
}

describe("sending a result", () => {
  it("passes on that the page saw no release, for a first send", async () => {
    actions.sms.mockResolvedValue({ status: "released", text: "Text", phone: "+255700000001", note: null })
    sendResult({ seenReleases: 0, repeat: null })
    await userEvent.click(screen.getByRole("button", { name: "Send SMS instead" }))
    expect(actions.sms).toHaveBeenCalledWith("lead-1", "interview-1", 0)
  })

  it("passes on the releases the confirmation showed when sending again", async () => {
    actions.sms.mockResolvedValue({ status: "released", text: "Text", phone: "+255700000001", note: null })
    sendResult({ seenReleases: 2, repeat: "It was already sent." })
    await userEvent.click(screen.getByRole("button", { name: "Send SMS instead" }))
    await userEvent.click(await screen.findByRole("button", { name: "Send again by SMS" }))
    expect(actions.sms).toHaveBeenCalledWith("lead-1", "interview-1", 2)
  })

  it("sends once when Send again is double-clicked", async () => {
    let finish: (value: unknown) => void = () => {}
    actions.whatsapp.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    sendResult({ seenReleases: 1, repeat: "It was already sent." })
    await userEvent.click(screen.getByRole("button", { name: "Send through WhatsApp" }))
    // jsdom runs no animations, so the dialog would leave at once. In a
    // browser it stays while it fades out, and can take a second click.
    const fading = { finished: new Promise(() => {}), cancel() {} } as unknown as Animation
    Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [fading] })
    const again = await screen.findByRole("button", { name: "Send again through WhatsApp" })
    // Two clicks before the dialog has faded out, as a fast double-click lands.
    fireEvent.click(again)
    fireEvent.click(again)
    finish({ status: "released", link: "https://wa.me/255700000001?text=Hi" })
    expect(await screen.findByRole("status")).toHaveTextContent("Recorded as sent.")
    expect(actions.whatsapp).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledTimes(1)
  })

  it("closes the WhatsApp tab and says to reload when someone else sent it meanwhile", async () => {
    actions.whatsapp.mockResolvedValue({
      status: "refused",
      message: "This result was sent by someone else meanwhile, so nothing was sent. Reload to see it.",
    })
    sendResult({ seenReleases: 0, repeat: null })
    await userEvent.click(screen.getByRole("button", { name: "Send through WhatsApp" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("sent by someone else meanwhile")
    expect(tab.close).toHaveBeenCalled()
    expect(tab.location.href).toBe("")
  })
})
