import { act, render, waitFor } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TurnstileWidgetHandle } from "@/components/turnstile-widget"

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

type RenderOptions = Record<string, unknown> & { "expired-callback"?: () => void }

function fakeTurnstile() {
  return {
    render: vi.fn<(container: HTMLElement, options: RenderOptions) => string>(() => "widget-1"),
    reset: vi.fn(),
    remove: vi.fn(),
  }
}

let turnstile: ReturnType<typeof fakeTurnstile>

async function loadWidget() {
  return (await import("@/components/turnstile-widget")).TurnstileWidget
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA")
  turnstile = fakeTurnstile()
  Object.assign(window, { turnstile })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  delete (window as { turnstile?: unknown }).turnstile
  document.querySelectorAll("script").forEach((script) => script.remove())
})

function lastOptions() {
  return turnstile.render.mock.calls.at(-1)![1]
}

describe("TurnstileWidget", () => {
  it("renders a managed, flexible widget for the form's action", async () => {
    const TurnstileWidget = await loadWidget()
    const { container } = render(<TurnstileWidget action="admission" language="en" />)

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1))
    expect(turnstile.render.mock.calls[0][0]).toBe(container.firstChild)
    expect(lastOptions()).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      action: "admission",
      size: "flexible",
      theme: "auto",
      language: "en",
    })
    // Managed mode is the widget's own setting in Cloudflare; the page never
    // asks for execute-on-demand or a hidden widget.
    expect(lastOptions()).not.toHaveProperty("execution")
    expect(lastOptions()).not.toHaveProperty("appearance")
  })

  it("falls back to the visitor's browser language for Swahili, which Turnstile doesn't offer", async () => {
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="admission" language="sw" />)

    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
    expect(lastOptions().language).toBe("auto")
  })

  it("resets itself when its token expires", async () => {
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="admission" language="sw" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    act(() => lastOptions()["expired-callback"]!())

    expect(turnstile.reset).toHaveBeenCalledWith("widget-1")
  })

  it("lets the form reset it after a refused submission", async () => {
    const TurnstileWidget = await loadWidget()
    const widget = createRef<TurnstileWidgetHandle>()
    render(<TurnstileWidget ref={widget} action="admission" language="sw" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    act(() => widget.current!.reset())

    expect(turnstile.reset).toHaveBeenCalledWith("widget-1")
  })

  it("removes the widget when the form goes away", async () => {
    const TurnstileWidget = await loadWidget()
    const { unmount } = render(<TurnstileWidget action="admission" language="sw" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    unmount()

    expect(turnstile.remove).toHaveBeenCalledWith("widget-1")
  })

  it("loads Cloudflare's script once, unproxied and explicit, then renders", async () => {
    delete (window as { turnstile?: unknown }).turnstile
    const TurnstileWidget = await loadWidget()
    render(
      <>
        <TurnstileWidget action="admission" language="sw" />
        <TurnstileWidget action="agent" language="sw" />
      </>,
    )

    const scripts = document.querySelectorAll(`script[src="${SCRIPT_SRC}"]`)
    expect(scripts).toHaveLength(1)
    expect(turnstile.render).not.toHaveBeenCalled()

    Object.assign(window, { turnstile })
    act(() => {
      scripts[0].dispatchEvent(new Event("load"))
    })

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2))
  })

  it("loads the script again on a later mount when it loaded without defining turnstile", async () => {
    delete (window as { turnstile?: unknown }).turnstile
    vi.spyOn(console, "error").mockImplementation(() => {})
    const TurnstileWidget = await loadWidget()
    const first = render(<TurnstileWidget action="admission" language="sw" />)

    await act(async () => {
      document.querySelector(`script[src="${SCRIPT_SRC}"]`)!.dispatchEvent(new Event("load"))
    })
    expect(document.querySelectorAll(`script[src="${SCRIPT_SRC}"]`)).toHaveLength(0)
    first.unmount()

    render(<TurnstileWidget action="admission" language="sw" />)
    const retry = document.querySelectorAll(`script[src="${SCRIPT_SRC}"]`)
    expect(retry).toHaveLength(1)

    Object.assign(window, { turnstile })
    act(() => {
      retry[0].dispatchEvent(new Event("load"))
    })

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1))
  })

  it("renders nothing, and says why, without a site key", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "")
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="admission" language="sw" />)

    await act(async () => {})
    expect(turnstile.render).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
  })
})
