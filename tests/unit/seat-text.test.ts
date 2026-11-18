import { describe, expect, test } from "vitest"

import {
  belowBookingNote,
  blockedNote,
  bookedSentence,
  genderHint,
  genderMoveWarning,
  noAnswerNote,
  seatWillBe,
  waitingNote,
  whyNoStream,
  type SeatChild,
} from "@/app/staff/applicants/[id]/seat-text"
import type { SeatStream, StreamTakes } from "@/lib/services/streams"

// Record payment's and Student details' words about a seat once streams are
// on (#449, v42 and the lead's answers of 2026-11-18).

const JUMA: SeatChild = { studentName: "Juma Ali Mrisho", gender: "Boy", className: "FORM 1" }
const AMINA: SeatChild = { studentName: "Amina Said Omar", gender: "Girl", className: "FORM 1" }
const REHEMA: SeatChild = { studentName: "Rehema Saidi Bakari", gender: null, className: "STD 6" }

const s = (label: string, takes: StreamTakes, position: number) => ({ label, takes, position })
const ref = (className: SeatChild["className"], label: string, takes: StreamTakes): SeatStream => ({ id: label, className, label, takes })

const FORM1 = [s("A", "Girls", 1), s("B", "Boys", 2)]

describe("Record payment's seat note", () => {
  test("v42's red note for a boy", () => {
    expect(blockedNote(JUMA, FORM1)).toEqual({
      title: "No stream can take him yet.",
      text: "FORM 1 A (Girls) is for girls and FORM 1 B (Boys) is full. A new FORM 1 stream for boys must be opened before his school fee can be recorded.",
    })
  })

  test("streams with the same reason are grouped", () => {
    expect(whyNoStream(JUMA, [...FORM1, s("C", "Boys", 3)])).toBe("FORM 1 A (Girls) is for girls, and FORM 1 B (Boys) and FORM 1 C (Boys) are full.")
    expect(whyNoStream(AMINA, [s("A", "Mixed", 1), s("B", "Boys", 2), s("C", "Girls", 3)])).toBe("FORM 1 A and FORM 1 C (Girls) are full, and FORM 1 B (Boys) is for boys.")
  })

  test("v42's note on where the payment places a boy, and the same for a girl", () => {
    expect(seatWillBe(JUMA, ref("FORM 1", "C", "Boys"))).toBe("His seat will be in FORM 1 C (Boys), the first stream for boys with a free seat.")
    expect(seatWillBe(AMINA, ref("FORM 1", "A", "Girls"))).toBe("Her seat will be in FORM 1 A (Girls), the first stream for girls with a free seat.")
  })

  test("what books the seat: the deposit, an amount, or nothing said for a waived fee", () => {
    expect(bookedSentence({ booksAt: 300_000, booksKind: "deposit" })).toBe("A seat is booked once the deposit is paid.")
    expect(bookedSentence({ booksAt: 160_000, booksKind: "first_share" })).toBe("A seat is booked once TZS 160,000 is paid.")
    expect(bookedSentence({ booksAt: 0, booksKind: "waived" })).toBeNull()
  })

  test("a child already waiting keeps paying", () => {
    expect(waitingNote(JUMA)).toEqual({
      title: "No stream can take him yet.",
      text: "He will wait until a FORM 1 stream for boys opens or a seat frees. He keeps his Seat priority and can keep paying.",
    })
  })

  test("v42's note after a payment below the deposit", () => {
    const note = belowBookingNote(JUMA, { amount: 100_000, totalPaid: 100_000, booksAt: 300_000, booksKind: "deposit", wouldTake: ref("FORM 1", "C", "Boys") })
    expect(note).toEqual({
      title: "TZS 100,000 recorded. A seat is booked once the deposit is paid.",
      text:
        "Juma has paid 100,000 of the 300,000 deposit, so he has no seat yet. If another boy pays the deposit first and takes the last seat, " +
        "Juma’s next payment waits until a stream has room. The 100,000 stays recorded either way.",
    })
    const share = belowBookingNote(AMINA, { amount: 50_000, totalPaid: 50_000, booksAt: 160_000, booksKind: "first_share", wouldTake: ref("FORM 1", "A", "Mixed") })
    expect(share.text).toContain("Amina has paid 50,000 of the 160,000 that books the seat, so she has no seat yet. If another child pays first")
  })
})

describe("correcting Boy or girl", () => {
  test("v42's warning when the seat moves, and the wait when no stream for the new answer has room", () => {
    const placed = ref("FORM 1", "B", "Boys")
    expect(genderMoveWarning(JUMA, "Girl", { placed, wouldTake: ref("FORM 1", "A", "Girls") })).toEqual({
      title: "This moves her out of FORM 1 B (Boys).",
      text: "She takes a seat in FORM 1 A (Girls), the first stream for girls with a free seat.",
    })
    expect(genderMoveWarning(JUMA, "Girl", { placed, wouldTake: null }).text).toBe("No FORM 1 stream for girls has a free seat, so she waits for a stream.")
  })
})

describe("a child with no Boy or girl answer", () => {
  const PRONOUN = /\b(he|him|his|she|her|hers)\b/i

  test("is named by the first name, never he or she", () => {
    const sentences = [
      Object.values(blockedNote(REHEMA, [s("A", "Mixed", 1), s("B", "Boys", 2)])).join(" "),
      seatWillBe(REHEMA, ref("STD 6", "B", "Mixed")),
      Object.values(waitingNote(REHEMA)).join(" "),
      Object.values(belowBookingNote(REHEMA, { amount: 100_000, totalPaid: 100_000, booksAt: 300_000, booksKind: "deposit", wouldTake: ref("STD 6", "B", "Mixed") })).join(" "),
      noAnswerNote(REHEMA, [s("A", "Mixed", 1)]),
      noAnswerNote(REHEMA, null),
      genderHint(REHEMA),
    ]
    for (const sentence of sentences) expect(sentence).not.toMatch(PRONOUN)
  })

  test("says what fits and what must change", () => {
    expect(blockedNote(REHEMA, [s("A", "Mixed", 1), s("B", "Boys", 2)])).toEqual({
      title: "No stream can take Rehema yet.",
      text: "STD 6 A is full and STD 6 B (Boys) is for boys. A new Mixed STD 6 stream must be opened, or Rehema’s Boy or girl answer given, before Rehema’s school fee can be recorded.",
    })
    expect(seatWillBe(REHEMA, ref("STD 6", "B", "Mixed"))).toBe("Rehema’s seat will be in STD 6 B, the first Mixed stream with a free seat.")
    expect(waitingNote(REHEMA).text).toBe("Rehema will wait until a Mixed STD 6 stream opens or a seat frees. Rehema keeps the Seat priority and can keep paying.")
    expect(noAnswerNote(REHEMA, [s("A", "Mixed", 1), s("B", "Mixed", 2)])).toBe(
      "Without an answer Rehema fits Mixed streams only. Every STD 6 stream is Mixed, so nothing changes for Rehema today.",
    )
    expect(noAnswerNote(REHEMA, [s("A", "Boys", 1)])).toBe("Without an answer Rehema fits Mixed streams only.")
    expect(genderHint(REHEMA)).toBe("Saved on the record. A Boy or girl answer can be changed but not cleared.")
    expect(genderHint(AMINA)).toBe("Saved on her record. A Boy or girl answer can be changed but not cleared.")
  })
})
