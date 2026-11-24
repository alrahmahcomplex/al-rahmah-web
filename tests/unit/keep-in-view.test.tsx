import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { KeepFocusInView, useKeepFocusInView } from "@/components/guided-form/keep-in-view"

// A phone keyboard leaves the top 400px of the page free.
const viewport = { offsetTop: 0, height: 400, addEventListener: vi.fn(), removeEventListener: vi.fn() }
const page = document.documentElement
const scrollBy = vi.fn()

function FormPage({ inset, fixed }: { inset?: number; fixed?: boolean }) {
  useKeepFocusInView(inset)
  return (
    <div style={fixed ? { position: "fixed" } : undefined}>
      <input aria-label="Phone" />
    </div>
  )
}

// The box sits 500 to 552px down the page, behind the keyboard.
function focusPhone(box: HTMLElement) {
  vi.spyOn(box, "getBoundingClientRect").mockReturnValue({ top: 500, bottom: 552, height: 52 } as DOMRect)
  act(() => box.focus())
  act(() => vi.advanceTimersByTime(60))
}

describe("useKeepFocusInView", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("visualViewport", viewport)
    Object.defineProperty(page, "scrollBy", { value: scrollBy, configurable: true })
    scrollBy.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete (page as unknown as Record<string, unknown>).scrollBy
  })

  it("scrolls a box the keyboard covers above it once, with the form's sticky bar height, though the app mounts it too", () => {
    const { getByLabelText } = render(
      <>
        <FormPage inset={112} />
        <KeepFocusInView />
      </>,
    )
    focusPhone(getByLabelText("Phone"))
    // Free space 112 to 384px; the box goes 35% of the way down the room left: 112 + (272 - 52) * 0.35 = 189.
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 500 - 189 }))
  })

  it("brings the box up again when the keyboard's autofill strip opens and leaves less room", () => {
    const onPage = render(<FormPage />).getByLabelText("Phone")
    const rect = vi.spyOn(onPage, "getBoundingClientRect").mockReturnValue({ top: 250, bottom: 302, height: 52 } as DOMRect)
    act(() => onPage.focus())
    act(() => vi.advanceTimersByTime(60))
    expect(scrollBy).not.toHaveBeenCalled()

    // The strip takes 120px more: the box's foot at 302 is now below 280 - 16.
    viewport.height = 280
    const onResize = viewport.addEventListener.mock.calls.findLast(([name]) => name === "resize")![1] as () => void
    act(() => onResize())
    act(() => vi.advanceTimersByTime(60))
    expect(scrollBy).toHaveBeenCalledTimes(1)
    viewport.height = 400
    rect.mockRestore()
  })

  it("leaves a box in a fixed panel that doesn't scroll alone", () => {
    const { getByLabelText } = render(<FormPage fixed />)
    focusPhone(getByLabelText("Phone"))
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it("stops listening once nothing mounts it", () => {
    const { unmount } = render(
      <>
        <FormPage />
        <KeepFocusInView />
      </>,
    )
    const box = document.querySelector("input")!
    unmount()
    document.body.appendChild(box)
    focusPhone(box)
    expect(scrollBy).not.toHaveBeenCalled()
    box.remove()
  })
})
