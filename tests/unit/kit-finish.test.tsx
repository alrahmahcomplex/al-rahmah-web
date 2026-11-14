import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FinishMark, rainConfetti, toast, Toaster } from "@/components/kit"

// The six confetti colours, as app/tokens.css sets them.
const TOKENS: Record<string, string> = {
  "--gf-orange": "#ee7300",
  "--gf-confetti-peach": "#ffb066",
  "--gf-indigo": "#0900bb",
  "--gf-confetti-violet": "#7b73ff",
  "--gf-green": "#0f7a3d",
  "--gf-confetti-mint": "#4cc38a",
}

/** A 2D context that records what is drawn: one save() per piece per frame, and every colour set. */
function fakeContext() {
  const colours = new Set<string>()
  const ctx = {
    saves: 0,
    colours,
    set fillStyle(v: string) {
      colours.add(v)
    },
    set strokeStyle(v: string) {
      colours.add(v)
    },
    save() {
      ctx.saves++
    },
  }
  for (const m of ["scale", "clearRect", "restore", "translate", "rotate", "fillRect", "beginPath", "arc", "fill", "moveTo", "lineTo", "closePath", "stroke"])
    Object.assign(ctx, { [m]: () => {} })
  return ctx
}

let ctx: ReturnType<typeof fakeContext>
let frames: FrameRequestCallback[]

function runOneFrame() {
  const next = frames
  frames = []
  for (const f of next) f(0)
}

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
}

beforeEach(() => {
  vi.useFakeTimers()
  ctx = fakeContext()
  frames = []
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never)
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f))
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
  for (const [k, v] of Object.entries(TOKENS)) document.documentElement.style.setProperty(k, v)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove("rm")
  document.querySelectorAll(".kit-cf").forEach((c) => c.remove())
  setWidth(1024)
})

describe("rainConfetti", () => {
  it("waits for the tick to finish, then bursts from the mark's centre with a ring", () => {
    setWidth(1280)
    const { container } = render(<FinishMark />)
    const mark = container.querySelector<HTMLElement>(".kit-mark")!
    rainConfetti(mark)
    expect(document.querySelector("canvas.kit-cf")).toBeNull()

    fireEvent.animationEnd(mark.querySelector(".kit-mark-tick")!)
    const canvas = document.querySelector("canvas.kit-cf")!
    expect(canvas).toHaveAttribute("aria-hidden", "true")
    expect(mark).toHaveAttribute("data-burst")

    runOneFrame()
    // 85 pieces on a desktop, in our six colours only.
    expect(ctx.saves).toBe(85)
    expect([...ctx.colours].sort()).toEqual(Object.values(TOKENS).sort())

    // It fires once: the fallback timer adds no second burst.
    act(() => vi.advanceTimersByTime(1000))
    expect(document.querySelectorAll("canvas.kit-cf")).toHaveLength(1)
  })

  it("sends 60 pieces on a phone, and fires after a second if the tick's end never comes", () => {
    setWidth(390)
    const { container } = render(<FinishMark />)
    rainConfetti(container.querySelector(".kit-mark"))
    act(() => vi.advanceTimersByTime(999))
    expect(document.querySelector("canvas.kit-cf")).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    runOneFrame()
    expect(ctx.saves).toBe(60)
  })

  it("finds the mark on the screen by itself, as a click handler calls it", () => {
    const { container } = render(<FinishMark />)
    const mark = container.querySelector<HTMLElement>(".kit-mark")!
    vi.spyOn(mark, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList)
    rainConfetti(new MouseEvent("click") as unknown as Element)
    fireEvent.animationEnd(mark.querySelector(".kit-mark-tick")!)
    expect(mark).toHaveAttribute("data-burst")
    expect(document.querySelector("canvas.kit-cf")).not.toBeNull()
  })

  it("does nothing under reduced motion", () => {
    document.documentElement.classList.add("rm")
    const { container } = render(<FinishMark />)
    rainConfetti(container.querySelector(".kit-mark"))
    act(() => vi.advanceTimersByTime(2000))
    expect(document.querySelector("canvas.kit-cf")).toBeNull()
  })
})

describe("toast", () => {
  it("draws its tone with the tone's icon; a failure is an alert", async () => {
    vi.useRealTimers()
    render(<Toaster />)
    act(() => toast("Saved. Amina’s interview is on 18 November at 09:00.", { tone: "good" }))
    const saved = await screen.findByRole("status")
    expect(saved).toHaveClass("kit-toast")
    expect(saved).toHaveAttribute("data-tone", "good")
    expect(saved).toHaveTextContent("Saved. Amina’s interview is on 18 November at 09:00.")
    expect(saved.querySelector("svg")).toHaveAttribute("aria-hidden", "true")

    act(() => toast("The batch stopped early because something went wrong."))
    act(() => toast("The batch stopped early because something went wrong.", { tone: "bad" }))
    const failed = await screen.findByRole("alert")
    expect(failed).toHaveAttribute("data-tone", "bad")
  })

  it("is plain news by default", async () => {
    vi.useRealTimers()
    render(<Toaster />)
    act(() => toast("Approved. Invite sent to asha@example.com."))
    const news = await screen.findByText("Approved. Invite sent to asha@example.com.")
    expect(news.closest(".kit-toast")).not.toHaveAttribute("data-tone")
  })
})
