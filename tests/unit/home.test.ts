import { describe, expect, it } from "vitest"

import { onlyFullClass, quickActions } from "@/app/staff/_home/quick-action-list"
import { sparkShape, SPARK_HEIGHT } from "@/app/staff/_home/spark"
import {
  addDays,
  appliedCard,
  appliedRange,
  homeDate,
  interviewCard,
  interviewRange,
  mondayOf,
  pickedDay,
  pickedWeek,
  shortDay,
  shortRange,
} from "@/app/staff/_home/stats"
import type { ClassSeatFigures } from "@/lib/services/dashboard"
import type { Permission } from "@/lib/permissions"

// Sunday 15 November 2026.
const TODAY = "2026-11-15"

describe("Home's dates", () => {
  it("steps across months and finds the Monday of a week", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(mondayOf(TODAY)).toBe("2026-11-09")
    expect(mondayOf("2026-11-09")).toBe("2026-11-09")
  })

  it("writes days and weeks short, and the page's date in full", () => {
    expect(shortDay("2026-11-04")).toBe("Wed 4 Nov")
    expect(shortRange("2026-10-12", "2026-10-18")).toBe("12–18 Oct")
    expect(shortRange("2026-10-26", "2026-11-01")).toBe("26 Oct–1 Nov")
    expect(homeDate(TODAY)).toBe("Sunday 15 November")
  })

  it("takes only a past day, and a week before this one", () => {
    expect(pickedDay("2026-11-04", TODAY)).toBe("2026-11-04")
    expect(pickedDay(TODAY, TODAY)).toBeNull()
    expect(pickedDay("2026-11-20", TODAY)).toBeNull()
    expect(pickedDay("2026-02-30", TODAY)).toBeNull()
    expect(pickedDay("yesterday", TODAY)).toBeNull()
    expect(pickedDay(undefined, TODAY)).toBeNull()

    // Any day of a past week picks its Monday.
    expect(pickedWeek("2026-10-15", TODAY)).toBe("2026-10-12")
    expect(pickedWeek("2026-11-08", TODAY)).toBe("2026-11-02")
    expect(pickedWeek("2026-11-10", TODAY)).toBeNull()
    expect(pickedWeek("2026-12-01", TODAY)).toBeNull()
  })
})

describe("the Interviews card", () => {
  const counts = { "2026-11-15": 3, "2026-11-08": 1, "2026-11-12": 2, "2026-11-04": 4, "2026-10-28": 6 }

  it("reads the 7 days it draws and the same day a week before", () => {
    expect(interviewRange(TODAY)).toEqual({ from: "2026-11-08", to: TODAY })
  })

  it("shows today against the same day last week", () => {
    const card = interviewCard(null, TODAY, counts)
    expect(card).toMatchObject({ value: 3, change: 2, comparedWith: "the same day last week", label: "Interviews today" })
    expect(card.days.map((day) => day.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", TODAY])
    expect(card.days.map((day) => day.value)).toEqual([0, 0, 0, 2, 0, 0, 3])
  })

  it("shows a past day, with its own 7 days ending on it", () => {
    const card = interviewCard("2026-11-04", TODAY, counts)
    expect(card).toMatchObject({ value: 4, change: -2, comparedWith: "the same day a week before", label: "Interviews on Wed 4 Nov" })
    expect(card.days.at(-1)).toEqual({ date: "2026-11-04", value: 4 })
  })
})

describe("the Applied card", () => {
  // Last week (2–8 Nov) had 5; this week so far (9–15 Nov) has 3.
  const counts = { "2026-11-03": 2, "2026-11-08": 3, "2026-11-10": 1, "2026-11-15": 2, "2026-10-14": 4, "2026-10-07": 1 }

  it("reads the week before through today, or through the past week's Sunday", () => {
    expect(appliedRange(null, TODAY)).toEqual({ from: "2026-11-02", to: TODAY })
    expect(appliedRange("2026-10-12", TODAY)).toEqual({ from: "2026-10-05", to: "2026-10-18" })
  })

  it("compares this week so far with the whole of last week", () => {
    const card = appliedCard(null, TODAY, counts)
    expect(card).toMatchObject({ value: 3, change: -2, comparedWith: "last week", label: "Applied this week" })
    expect(card.days.map((day) => day.value)).toEqual([0, 1, 0, 0, 0, 0, 2])
  })

  it("shows a past week from Monday to Sunday", () => {
    const card = appliedCard("2026-10-12", TODAY, counts)
    expect(card).toMatchObject({ value: 4, change: 3, comparedWith: "the week before", label: "Applied 12–18 Oct" })
    expect(card.days[0].date).toBe("2026-10-12")
    expect(card.days.at(-1)?.date).toBe("2026-10-18")
  })
})

describe("the 7-day line", () => {
  it("puts one dot a day across the width, the highest at the top and zero at the bottom", () => {
    const shape = sparkShape([0, 2, 4, 2, 0, 0, 1])
    expect(shape.dots.map((dot) => dot.left)).toEqual([0, 16.7, 33.3, 50, 66.7, 83.3, 100])
    expect(shape.dots[2].top).toBeLessThan(shape.dots[1].top)
    expect(shape.dots[0].top).toBe(shape.dots[4].top)
    expect(shape.line.startsWith("M0,")).toBe(true)
    expect(shape.area.endsWith(`L0,${SPARK_HEIGHT} Z`)).toBe(true)
  })

  it("never curves past a flat run, so a quiet day stays on the floor", () => {
    const shape = sparkShape([3, 0, 0, 3])
    // The middle segment between two zeros is a straight line along the floor.
    const middle = shape.line.split(" C")[2]
    const ys = middle.split(" ").map((point) => Number(point.split(",")[1]))
    expect(new Set(ys).size).toBe(1)
  })

  it("draws a week of nothing as a flat line", () => {
    const shape = sparkShape([0, 0, 0, 0, 0, 0, 0])
    expect(new Set(shape.dots.map((dot) => dot.top)).size).toBe(1)
  })
})

describe("Quick actions", () => {
  const seat = (className: string, dayOrBoarding: "Day" | "Boarding", seats: number | null, taken: number) =>
    ({ className, dayOrBoarding, seats, taken }) as ClassSeatFigures

  it("names the one full class, and no class when none or several are full", () => {
    expect(onlyFullClass([seat("STD 6", "Day", 35, 35), seat("FORM 1", "Day", 60, 44)])).toBe("STD 6")
    expect(onlyFullClass([seat("STD 6", "Day", 35, 36)])).toBe("STD 6")
    expect(onlyFullClass([seat("STD 6", "Day", 35, 34), seat("KG 1", "Day", null, 9)])).toBeNull()
    expect(onlyFullClass([seat("STD 6", "Day", 35, 35), seat("STD 5", "Day", 30, 30)])).toBeNull()
    // Full for Day pupils but not Boarders is not "STD 6 is full".
    expect(onlyFullClass([seat("STD 6", "Day", 35, 35), seat("STD 6", "Boarding", 20, 12)])).toBeNull()
    expect(onlyFullClass([seat("STD 6", "Day", 35, 35), seat("STD 6", "Boarding", 20, 20)])).toBe("STD 6")
    // Boarding seats not set are never full, so the class is not full.
    expect(onlyFullClass([seat("STD 6", "Day", 35, 35), seat("STD 6", "Boarding", null, 4)])).toBeNull()
  })

  const all: Permission[] = ["leads.view", "academic_years.manage", "payments.view", "discounts.approve"]

  it("shows each row only to staff who can open its page, with a caption only when there is something to say", () => {
    expect(quickActions({ permissions: all, overdue: 2, fullClass: "STD 6", waitingDiscounts: 3 })).toEqual([
      { href: "/staff/follow-ups", icon: "followups", title: "Call a family back", caption: "2 overdue" },
      { href: "/staff/seats", icon: "seats", title: "Seats", caption: "STD 6 is full" },
      { href: "/staff/discounts", icon: "discounts", title: "Request a discount", caption: "3 waiting for a decision" },
    ])
    expect(quickActions({ permissions: all, overdue: 0, fullClass: null, waitingDiscounts: 0 }).map((action) => action.caption)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(quickActions({ permissions: ["leads.view"], overdue: 1, fullClass: null, waitingDiscounts: null }).map((action) => action.title)).toEqual([
      "Call a family back",
    ])
    expect(quickActions({ permissions: ["academic_years.manage"], overdue: null, fullClass: "STD 6", waitingDiscounts: null })).toEqual([])
  })
})
