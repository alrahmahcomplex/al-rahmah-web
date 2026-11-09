import { act, render, screen, waitFor } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TurnstileWidgetHandle } from "@/components/turnstile-widget"

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

type RenderOptions = Record<string, unknown> & {
  callback?: () => void
  "before-interactive-callback"?: () => void
  "error-callback"?: (code: string) => boolean
  "unsupported-callback"?: () => void
  "expired-callback"?: () => void
}

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
  it("renders a managed widget that shows only when Cloudflare needs a click", async () => {
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="admission" language="en" />)

    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1))
    expect(lastOptions()).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      action: "admission",
      theme: "auto",
      appearance: "interaction-only",
      language: "en",
    })
    // Managed mode is the widget's own setting in Cloudflare; the page never
    // asks for execute-on-demand.
    expect(lastOptions()).not.toHaveProperty("execution")
  })

  it("uses the compact size where flexible's 300px minimum would overflow", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(261)
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="agent-link" language="en" />)

    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
    expect(lastOptions().size).toBe("compact")
  })

  it("fills a container at least 300px wide", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(340)
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="admission" language="en" />)

    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
    expect(lastOptions().size).toBe("flexible")
  })

  it("draws the check again at the size that fits when the space crosses 300px", async () => {
    let resized = () => {}
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(340)
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="admission" language="en" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1))
    expect(lastOptions().size).toBe("flexible")

    // A width change that keeps the same size draws nothing new.
    width.mockReturnValue(320)
    act(() => resized())
    expect(turnstile.render).toHaveBeenCalledTimes(1)

    act(() => lastOptions()["before-interactive-callback"]!())
    width.mockReturnValue(261)
    act(() => resized())
    // The widget drawn again starts with no message until Cloudflare asks.
    expect(screen.queryByText("Tick the security check below, then send.")).toBeNull()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2))
    expect(turnstile.remove).toHaveBeenCalledWith("widget-1")
    expect(lastOptions().size).toBe("compact")
    vi.unstubAllGlobals()
  })

  it("says in words when the check needs a click, and brings it into view on send", async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const TurnstileWidget = await loadWidget()
    const widget = createRef<TurnstileWidgetHandle>()
    render(<TurnstileWidget ref={widget} action="admission" language="sw" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    // Nothing to show while Cloudflare passes the visitor on its own.
    expect(widget.current!.reveal()).toBe(false)
    expect(scroll).not.toHaveBeenCalled()

    act(() => lastOptions()["before-interactive-callback"]!())
    const message = screen.getByText("Weka alama kwenye ukaguzi wa usalama hapa chini, kisha utume.")
    expect(message).toHaveAttribute("aria-live", "polite")

    let revealed = false
    act(() => {
      revealed = widget.current!.reveal()
    })
    expect(revealed).toBe(true)
    expect(scroll).toHaveBeenCalled()
    expect(message).toHaveFocus()

    // A token clears the message.
    act(() => lastOptions().callback!())
    expect(screen.queryByText("Weka alama kwenye ukaguzi wa usalama hapa chini, kisha utume.")).toBeNull()
    expect(widget.current!.reveal()).toBe(false)
  })

  it("reads out a check that fails twice in a row, and logs Cloudflare's error code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const TurnstileWidget = await loadWidget()
    const widget = createRef<TurnstileWidgetHandle>()
    render(<TurnstileWidget ref={widget} action="admission" language="en" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    let handled = false
    act(() => {
      handled = lastOptions()["error-callback"]!("300010")
    })
    expect(handled).toBe(true)
    expect(error).toHaveBeenCalledWith(expect.stringContaining("300010"))
    act(() => {
      lastOptions()["error-callback"]!("300010")
    })

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("The security check couldn't load. Reload the page and try again.")
    act(() => {
      widget.current!.reveal()
    })
    expect(alert).toHaveFocus()
  })

  it("stays quiet after one error while Turnstile retries, and a success starts the count again (#272)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const TurnstileWidget = await loadWidget()
    const widget = createRef<TurnstileWidgetHandle>()
    render(<TurnstileWidget ref={widget} action="admission" language="en" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    act(() => {
      lastOptions()["error-callback"]!("300010")
    })
    expect(screen.queryByRole("alert")).toBeNull()
    // Nothing of its own to show, so the form says to wait.
    expect(widget.current!.reveal()).toBe(false)

    act(() => lastOptions().callback!())
    act(() => {
      lastOptions()["error-callback"]!("300010")
    })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says it couldn't load when Turnstile hasn't recovered from one error in time", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="admission" language="en" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    vi.useFakeTimers()
    try {
      act(() => {
        lastOptions()["error-callback"]!("110200")
      })
      act(() => vi.advanceTimersByTime(14_000))
      expect(screen.queryByRole("alert")).toBeNull()
      act(() => vi.advanceTimersByTime(1_000))
      expect(screen.getByRole("alert")).toHaveTextContent("The security check couldn't load.")
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps a token it earned out of sight when the space crosses 300px, and fits the size when a click is needed (#272)", async () => {
    let resized = () => {}
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(340)
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="admission" language="en" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1))

    // Passed without a click: the widget is invisible, so its size doesn't
    // matter and its token stays.
    act(() => lastOptions().callback!())
    width.mockReturnValue(261)
    act(() => resized())
    await act(async () => {})
    expect(turnstile.render).toHaveBeenCalledTimes(1)
    expect(turnstile.remove).not.toHaveBeenCalled()

    // Its token expired and Cloudflare now wants a click: drawn again at the
    // size that fits before the box shows.
    act(() => lastOptions()["before-interactive-callback"]!())
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2))
    expect(lastOptions().size).toBe("compact")
    expect(screen.queryByText("Tick the security check below, then send.")).toBeNull()
    act(() => lastOptions()["before-interactive-callback"]!())
    expect(screen.getByText("Tick the security check below, then send.")).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it("points a browser Turnstile doesn't support to another browser or the office", async () => {
    const TurnstileWidget = await loadWidget()
    render(<TurnstileWidget action="admission" language="sw" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    act(() => lastOptions()["unsupported-callback"]!())

    expect(screen.getByRole("alert")).toHaveTextContent("Jaribu kivinjari kingine, au piga simu ofisini.")
  })

  it("keeps its spacing after a tick, while Cloudflare's box still shows success", async () => {
    const TurnstileWidget = await loadWidget()
    const { container } = render(<TurnstileWidget action="admission" language="en" className="mt-5" />)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
    expect(container.firstChild).not.toHaveClass("mt-5")

    act(() => lastOptions()["before-interactive-callback"]!())
    expect(container.firstChild).toHaveClass("mt-5")

    act(() => lastOptions().callback!())
    expect(container.firstChild).toHaveClass("mt-5")
    expect(screen.queryByText("Tick the security check below, then send.")).toBeNull()
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
    expect(screen.getByRole("alert")).toHaveTextContent("Ukaguzi wa usalama haukuweza kufunguka.")
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
