import { describe, expect, it } from "vitest"

import { anchorFigures } from "@/app/apply/price-anchor"

// What the price box's green side states (prototype WhJUMnd7XoaPF4XBmGcJja v3).

const base = { answer: null, checking: false, standard: 10000, lowest: 10000, highest: 20000 }

describe("the price box figures", () => {
  it("states a confirmed code's own saving, whatever the range", () => {
    expect(anchorFigures({ ...base, answer: { status: "approved", amount: 30000 } })).toEqual({ kind: "code", saving: 20000 })
    expect(anchorFigures({ ...base, answer: { status: "approved", amount: 45000 } })).toEqual({ kind: "code", saving: 5000 })
  })

  it("states the range for no code, a code that saves nothing, a code being checked, and a check that failed", () => {
    const range = { kind: "range", lowest: 10000, highest: 20000 }
    expect(anchorFigures(base)).toEqual(range)
    expect(anchorFigures({ ...base, answer: { status: "approved", amount: 50000 } })).toEqual(range)
    expect(anchorFigures({ ...base, answer: { status: "pending", amount: 50000 } })).toEqual(range)
    expect(anchorFigures({ ...base, answer: { status: "unknown", amount: 50000 } })).toEqual(range)
    expect(anchorFigures({ ...base, answer: { status: "unavailable" } })).toEqual(range)
    expect(anchorFigures({ ...base, checking: true, answer: { status: "approved", amount: 30000 } })).toEqual(range)
  })

  it("states one saving when every working code gives the same", () => {
    expect(anchorFigures({ ...base, lowest: 15000, highest: 15000 })).toEqual({ kind: "one", saving: 15000 })
  })

  it("falls back to the standard amount when the range is unknown or no code gives a saving", () => {
    expect(anchorFigures({ ...base, lowest: null, highest: null })).toEqual({ kind: "one", saving: 10000 })
    expect(anchorFigures({ ...base, lowest: 0, highest: 0 })).toEqual({ kind: "one", saving: 10000 })
  })

  it("states nothing when no figure is known", () => {
    expect(anchorFigures({ ...base, standard: null, lowest: null, highest: null })).toBeNull()
  })
})
