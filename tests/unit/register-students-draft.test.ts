import { afterEach, describe, expect, test, vi } from "vitest"

import { readDraft, saveDraft } from "@/app/staff/check-in/new/draft"
import { freshAnswers, type Answers } from "@/app/staff/check-in/new/model"

// The Register students draft (#308): one staff member's answers never
// outlive their sign-out in a tab the next staff member uses.

const KEY = "al-rahmah:register-students:"
const answers = (first: string): Answers => ({
  ...freshAnswers(1),
  students: [{ key: 1, name: { firstName: first, fatherFirst: "JUMA", fatherMiddle: "SALIM", fatherLast: "FIXTURE" } }],
})

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe("the Register students draft", () => {
  test("comes back for the staff member who wrote it", () => {
    saveDraft("staff-a", answers("NEEMA"))
    expect(readDraft("staff-a")).toEqual(answers("NEEMA"))
  })

  test("reading it removes every other staff member's draft, and nothing else", () => {
    saveDraft("staff-a", answers("NEEMA"))
    saveDraft("staff-b", answers("HAMISI"))
    saveDraft("staff-c", answers("ZAWADI"))
    window.sessionStorage.setItem("al-rahmah:other", "kept")

    expect(readDraft("staff-b")).toEqual(answers("HAMISI"))
    expect(window.sessionStorage.getItem(`${KEY}staff-a`)).toBeNull()
    expect(window.sessionStorage.getItem(`${KEY}staff-c`)).toBeNull()
    expect(window.sessionStorage.getItem(`${KEY}staff-b`)).not.toBeNull()
    expect(window.sessionStorage.getItem("al-rahmah:other")).toBe("kept")
  })

  test("a staff member with no draft still clears the one left behind", () => {
    saveDraft("staff-a", answers("NEEMA"))
    expect(readDraft("staff-b")).toBeNull()
    expect(window.sessionStorage.length).toBe(0)
  })

  test("with storage blocked the form reads no draft and does not throw", () => {
    const key = vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("blocked")
    })
    saveDraft("staff-a", answers("NEEMA"))
    expect(readDraft("staff-a")).toEqual(answers("NEEMA"))
    expect(key).toHaveBeenCalled()
  })
})
