import { describe, expect, test } from "vitest"

import { cardLines, MAX_SHOWN, PAGE_SIZE, shownFrom, STUDENTS_COPY } from "@/app/discount-code/students/copy"
import { discountCodeShareLink } from "@/lib/discount-code-share"
import type { AgentStudent } from "@/lib/services/agent-students"

const base: AgentStudent = {
  name: "Amina Wangu",
  className: "STD 3",
  status: "Applied",
  notActive: false,
  lastChange: "2026-11-05",
  declinedReason: null,
  interviewRegistered: false,
  result: null,
}

describe("a student card", () => {
  test("shows the status and the date of the last change", () => {
    expect(cardLines(base, "sw")).toEqual(["Amejisajili", "Imebadilika mwisho: 5 Nov 2026"])
    expect(cardLines(base, "en")).toEqual(["Applied", "Last change: 5 Nov 2026"])
  })

  test("adds not active when a closure mark is set", () => {
    expect(cardLines({ ...base, notActive: true }, "en")[0]).toBe("Applied · not active")
    expect(cardLines({ ...base, notActive: true }, "sw")[0]).toBe("Amejisajili · haendelei kwa sasa")
  })

  test("shows the exact Declined reason", () => {
    const declined = { ...base, status: "Declined" as const, declinedReason: "Did not pass interview" }
    expect(cardLines(declined, "en")).toContain("Did not pass interview")
    expect(cardLines(declined, "sw")).toContain("Hakufaulu usaili")
  })

  test("before the result is out it says so, without mentioning payment", () => {
    const lines = cardLines({ ...base, status: "Interviewed", interviewRegistered: true }, "sw")
    expect(lines).toContain("Matokeo bado hayajatoka")
    for (const language of ["sw", "en"] as const) {
      expect(STUDENTS_COPY[language].resultPending).not.toMatch(/pay|paid|lipa|malipo|ada|fee|TZS/i)
    }
  })

  test("shows the result and score once released", () => {
    const passed = { ...base, status: "Interviewed" as const, interviewRegistered: true, result: { outcome: "Passed" as const, score: 72.5 } }
    expect(cardLines(passed, "en")).toContain("Interview: Passed, score 72.5%")
    expect(cardLines(passed, "sw")).toContain("Usaili: Amefaulu, alama 72.5%")
    expect(cardLines(passed, "sw")).not.toContain("Matokeo bado hayajatoka")
  })

  test("every status and Declined reason has Swahili and English", () => {
    for (const language of ["sw", "en"] as const) {
      expect(Object.keys(STUDENTS_COPY[language].statuses)).toHaveLength(5)
      expect(Object.keys(STUDENTS_COPY[language].declinedReasons)).toHaveLength(9)
    }
  })

  test("agent-facing words never say agent, referral or Wakala", () => {
    for (const copy of Object.values(STUDENTS_COPY)) {
      const words = [
        JSON.stringify(copy),
        copy.heading("ABC-123", 3),
        copy.lastChange("5 Nov 2026"),
        copy.result("Passed", 70),
        copy.result("Failed", 30),
      ]
      for (const text of words) expect(text).not.toMatch(/agent|referral|wakala/i)
    }
    expect(STUDENTS_COPY.sw.helpLine).toBe("Huoni familia? Waombe wahakikishe walitumia code yako, au piga simu ofisini.")
  })
})

describe("how many rows to show", () => {
  test("is a whole number of pages from one page up to the largest", () => {
    expect(shownFrom(undefined)).toBe(PAGE_SIZE)
    expect(shownFrom("abc")).toBe(PAGE_SIZE)
    expect(shownFrom("-40")).toBe(PAGE_SIZE)
    expect(shownFrom("40")).toBe(40)
    expect(shownFrom("41")).toBe(60)
    expect(shownFrom("100000")).toBe(MAX_SHOWN)
    expect(shownFrom(["40", "60"])).toBe(PAGE_SIZE)
  })
})

describe("the share link", () => {
  test("has no number, so the sender picks the chat, and encodes the text", () => {
    expect(discountCodeShareLink("Code AJM-407 + punguzo: https://x.example/apply?ref=AJM-407")).toBe(
      "https://wa.me/?text=Code%20AJM-407%20%2B%20punguzo%3A%20https%3A%2F%2Fx.example%2Fapply%3Fref%3DAJM-407",
    )
  })

  test("is null when the text can't be sent", () => {
    expect(discountCodeShareLink("x".repeat(9000))).toBeNull()
  })
})
