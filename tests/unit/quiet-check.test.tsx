import { act, fireEvent, render, screen } from "@testing-library/react"
import { forwardRef, useEffect, useImperativeHandle } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fake = vi.hoisted(() => ({
  status: null as null | ((status: string, token: string | null) => void),
  redraw: vi.fn(),
  reset: vi.fn(),
  reveal: vi.fn(() => true),
}))
vi.mock("@/components/turnstile-widget", () => ({
  TurnstileWidget: forwardRef(function FakeTurnstile({ onStatus }: { onStatus?: (status: string, token: string | null) => void }, ref) {
    useImperativeHandle(ref, () => ({ redraw: fake.redraw, reset: fake.reset, reveal: fake.reveal }))
    useEffect(() => {
      fake.status = onStatus ?? null
    })
    return null
  }),
}))

import { QuietCheck, SLOW_CHECK_MS, useQuietCheck } from "@/app/discount-code/quiet-check"

// The agent sign-up's quiet security check (owner, prototype v5): nothing
// shows while it works; slow or failed, it says what to do.

function Harness({ send }: { send: () => void }) {
  const check = useQuietCheck()
  return (
    <>
      <QuietCheck check={check} language="en" />
      <button type="button" onClick={() => (check.token() ? send() : check.begin(send))}>
        {check.waiting ? "Sending…" : "Send"}
      </button>
    </>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  fake.redraw.mockReset()
  fake.reveal.mockReset().mockReturnValue(true)
})
afterEach(() => vi.useRealTimers())

describe("useQuietCheck", () => {
  it("sends by itself once the check passes, saying nothing meanwhile", () => {
    const send = vi.fn()
    render(<Harness send={send} />)
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(screen.getByRole("button", { name: "Sending…" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).toBeNull()

    act(() => fake.status?.("ready", "token-1"))
    act(() => vi.runOnlyPendingTimers())
    expect(send).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument()
  })

  it("says the check is slow after 20 seconds, and not before", () => {
    render(<Harness send={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    act(() => vi.advanceTimersByTime(SLOW_CHECK_MS - 1))
    expect(screen.queryByRole("alert")).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The security check is taking longer than usual. Press the button below to run the check again. Your progress is saved, so you won't have to enter your details from scratch.",
    )
    fireEvent.click(screen.getByRole("button", { name: "Run the check again" }))
    expect(fake.redraw).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("leaves a check that needs a click to Cloudflare's box, brought into view", () => {
    render(<Harness send={vi.fn()} />)
    act(() => fake.status?.("needsClick", null))
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(fake.reveal).toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(SLOW_CHECK_MS))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says a failed check can run again, then points to the connection or the office if it fails again", () => {
    const send = vi.fn()
    render(<Harness send={send} />)
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    act(() => fake.status?.("failed", null))
    expect(screen.getByRole("alert")).toHaveTextContent(/^The security check didn't load\. Press the button below/)

    fireEvent.click(screen.getByRole("button", { name: "Run the check again" }))
    act(() => fake.status?.("checking", null))
    act(() => fake.status?.("failed", null))
    expect(screen.getByRole("alert")).toHaveTextContent(/^The security check still didn't load\. Check your internet connection.*call the office/)

    // A later pass still sends.
    fireEvent.click(screen.getByRole("button", { name: "Run the check again" }))
    act(() => fake.status?.("ready", "token-2"))
    act(() => vi.runOnlyPendingTimers())
    expect(send).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says nothing about a check that failed before anyone sent", () => {
    render(<Harness send={vi.fn()} />)
    act(() => fake.status?.("failed", null))
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(screen.getByRole("alert")).toHaveTextContent(/didn't load/)
  })
})
