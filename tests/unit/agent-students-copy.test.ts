import { describe, expect, test } from "vitest"

import { cardLines, firstName, MAX_SHOWN, PAGE_SIZE, shownFrom, stepFrom, STUDENTS_COPY } from "@/app/discount-code/students/copy"
import type { AgentStudent } from "@/lib/services/agent-students"

const base: AgentStudent = {
  id: "1ead0000-0000-4000-8000-000000000001",
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
        copy.hello("Amina"),
        copy.remindHeading(4),
        ...(["Applied", "Visited", "Interviewed"] as const).flatMap((step) => [copy.waiting[step](14), copy.reminder[step]("Neema", "+255 673 526 644")]),
        copy.lastChange("5 Nov 2026"),
        copy.result("Passed", 70),
        copy.result("Failed", 30),
      ]
      for (const text of words) expect(text).not.toMatch(/agent|referral|wakala/i)
    }
    expect(STUDENTS_COPY.sw.helpLine).toBe("Huoni familia? Waombe wahakikishe walitumia code yako, au piga simu ofisini.")
  })
})

describe("the dashboard's words", () => {
  test("the reminders say the step, the days and the office, in both languages", () => {
    expect(STUDENTS_COPY.sw.waiting.Applied(23)).toBe("Alijisajili siku 23 zilizopita, bado hajatembelea shule.")
    expect(STUDENTS_COPY.en.waiting.Interviewed(14)).toBe("Passed the interview 14 days ago, not enrolled yet.")
    expect(STUDENTS_COPY.sw.reminder.Visited("Imani", "+255 673 526 644")).toBe(
      "Habari! Asante kwa kutembelea Al-Rahmah Complex na Imani. Hatua inayofuata ni usaili. Piga ofisi ya udahili kujua siku: +255 673 526 644.",
    )
    expect(STUDENTS_COPY.en.reminder.Interviewed("Asha", "+255 673 526 644")).toContain("Congratulations, Asha passed the interview")
  })

  test("a name reads by its first word, as people write it", () => {
    expect(firstName("REHEMA ALI JUMA")).toBe("Rehema")
    expect(firstName("  amina  k ")).toBe("Amina")
  })

  test("only the five statuses are a step to list", () => {
    expect(stepFrom("Visited")).toBe("Visited")
    expect(stepFrom("visited")).toBeNull()
    expect(stepFrom(["Visited"])).toBeNull()
    expect(stepFrom(undefined)).toBeNull()
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
