import { act, render } from "@testing-library/react"
import { useRef, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ScrollBar } from "@/components/kit"

// The kit's scrollbar (DESIGN.md, Outside scrollbar): it shows only while
// there is more to scroll, and follows the content as it grows, shrinks and
// gains or loses children. jsdom has no layout, so the sizes are set by hand
// and a stand-in ResizeObserver reports changes on demand.

class FakeResizeObserver {
  static all: FakeResizeObserver[] = []
  watched = new Set<Element>()
  constructor(private readonly callback: () => void) {
    FakeResizeObserver.all.push(this)
  }
  observe(element: Element) {
    this.watched.add(element)
  }
  disconnect() {
    this.watched.clear()
  }
  unobserve(element: Element) {
    this.watched.delete(element)
  }
  // A size change on `element` reaches the callback only if it is watched.
  static resize(element: Element) {
    for (const observer of FakeResizeObserver.all) if (observer.watched.has(element)) observer.callback()
  }
}

function size(element: Element, sizes: { scrollHeight?: number; clientHeight?: number }) {
  for (const [key, value] of Object.entries(sizes)) Object.defineProperty(element, key, { configurable: true, value })
}

let coarse = false
let frames: FrameRequestCallback[] = []
// Runs the frames the bar asked for, as the browser would on its next paint.
const paint = () => {
  const due = frames
  frames = []
  for (const run of due) run(0)
}

beforeEach(() => {
  FakeResizeObserver.all = []
  coarse = false
  vi.stubGlobal("ResizeObserver", FakeResizeObserver)
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: coarse && query === "(pointer: coarse)" }))
  frames = []
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run))
  vi.stubGlobal("cancelAnimationFrame", () => {})
})

afterEach(() => vi.unstubAllGlobals())

function Scroller({ rows }: { rows: number }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div>
      <div ref={ref} data-testid="scroll">
        {Array.from({ length: rows }, (_, i) => (
          <p key={i}>Row {i}</p>
        ))}
      </div>
      <ScrollBar target={ref} />
    </div>
  )
}

function setUp(rows: number) {
  const view = render(<Scroller rows={rows} />)
  const scroll = view.getByTestId("scroll")
  const bar = view.container.querySelector(".kit-vbar")!
  return { view, scroll, bar }
}

describe("ScrollBar", () => {
  it("shows only while there is more to scroll, and follows the content growing and shrinking", () => {
    // Sizes are set before the effect runs, through the first render's elements.
    const { scroll, bar } = setUp(2)
    size(bar, { clientHeight: 300 })
    size(scroll, { clientHeight: 300, scrollHeight: 300 })
    act(() => {
      FakeResizeObserver.resize(scroll)
      paint()
    })
    expect(bar).not.toHaveAttribute("data-on")

    // The content grows without the scrolling element changing size: a child resizes.
    size(scroll, { scrollHeight: 900 })
    act(() => {
      FakeResizeObserver.resize(scroll.children[0])
      paint()
    })
    expect(bar).toHaveAttribute("data-on")

    size(scroll, { scrollHeight: 300 })
    act(() => {
      FakeResizeObserver.resize(scroll.children[1])
      paint()
    })
    expect(bar).not.toHaveAttribute("data-on")
  })

  it("watches children added after it started", () => {
    function Growing() {
      const ref = useRef<HTMLDivElement>(null)
      const [rows, setRows] = useState(1)
      return (
        <div>
          <button onClick={() => setRows((n) => n + 1)}>More</button>
          <div ref={ref} data-testid="scroll">
            {Array.from({ length: rows }, (_, i) => (
              <p key={i}>Row {i}</p>
            ))}
          </div>
          <ScrollBar target={ref} />
        </div>
      )
    }
    const view = render(<Growing />)
    const scroll = view.getByTestId("scroll")
    const bar = view.container.querySelector(".kit-vbar")!
    size(bar, { clientHeight: 300 })
    size(scroll, { clientHeight: 300, scrollHeight: 300 })

    act(() => view.getByRole("button", { name: "More" }).click())
    // MutationObserver runs as a microtask.
    return Promise.resolve().then(() => {
      act(() => paint())
      expect(bar).not.toHaveAttribute("data-on")
      const added = scroll.children[1]
      size(scroll, { scrollHeight: 900 })
      act(() => {
        FakeResizeObserver.resize(added)
        paint()
      })
      expect(bar).toHaveAttribute("data-on")
    })
  })

  it("draws nothing on a touch screen", () => {
    coarse = true
    const { scroll, bar } = setUp(3)
    size(bar, { clientHeight: 300 })
    size(scroll, { clientHeight: 300, scrollHeight: 900 })
    act(() => FakeResizeObserver.resize(scroll))
    expect(FakeResizeObserver.all).toHaveLength(0)
    expect(bar).not.toHaveAttribute("data-on")
  })

  it("stops watching once it is gone", () => {
    const { view, scroll } = setUp(2)
    const [observer] = FakeResizeObserver.all
    expect(observer.watched.has(scroll)).toBe(true)
    view.unmount()
    expect(observer.watched.size).toBe(0)
  })
})
