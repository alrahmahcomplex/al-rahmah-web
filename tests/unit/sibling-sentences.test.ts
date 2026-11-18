import { describe, expect, test } from "vitest"

import type { SiblingGroupExplanation, SiblingMemberExplanation, SiblingNote, SiblingReason } from "@/lib/services/sibling-counts"
import { describeSiblingGroup, type SiblingViewExtras } from "@/lib/sibling-group-view"
import { feeChip, NO_FACTS, NOTE_LINES, noteLines, REASON_SENTENCES, reasonSentence } from "@/lib/sibling-sentences"

// "Why this fee" (#310): one sentence per reason code of
// explain_sibling_group (#306) and one line per note, in English and
// Swahili, as the owner approved them in the Sibling fee screens prototype.

// Every code the migration (20261218100100_sibling_counts.sql) documents.
const REASONS: SiblingReason[] = [
  "manual_full",
  "manual_ten",
  "kept_when_leaving_legacy",
  "prior_sibling",
  "enrolled_full",
  "enrolled_ten_anchor",
  "enrolled_ten_full_payer_waiting",
  "enrolled_ten_no_full",
  "locked_not_enrolled",
  "enrolled_unlocked",
  "no_family",
  "on_own",
  "legacy_sibling_enrolled",
  "legacy_no_sibling_enrolled",
  "request_pending",
  "request_needed",
  "request_refused",
  "declined",
  "closed",
  "anchor",
  "full_payer",
  "full_payer_sibling",
  "no_full_payer",
]
const NOTES: SiblingNote[] = ["granted", "request_pending", "fee_edit_needed", "larger_discount", "prior_sibling_tick", "grants_paused", "result_out_of_step"]

describe("every code has a sentence in both languages", () => {
  test.each(REASONS)("%s", (reason) => {
    const facts = { ...NO_FACTS, siblings: ["Salma"], fullPayer: "Khalid", kept: "ten" as const, closure: "Archived" as const }
    expect(reasonSentence(reason, facts, "en")).toMatch(/\S.*\.$/)
    expect(reasonSentence(reason, facts, "sw")).toMatch(/\S.*\.$/)
    expect(reasonSentence(reason, facts, "sw")).not.toBe(reasonSentence(reason, facts, "en"))
  })

  test("no code is missing or extra", () => {
    expect(Object.keys(REASON_SENTENCES).sort()).toEqual([...REASONS].sort())
    expect(Object.keys(NOTE_LINES).sort()).toEqual([...NOTES].sort())
  })

  test.each(NOTES)("note %s", (note) => {
    const facts = { ...NO_FACTS, grantedOn: "18 Nov 2026", larger: "staff_child" as const }
    expect(NOTE_LINES[note].en(facts)).toMatch(/\S.*\.$/)
    expect(NOTE_LINES[note].sw(facts)).toMatch(/\S.*\.$/)
  })
})

describe("the approved words", () => {
  test("the full payer: highest, equal fees, a dearer sibling later, and without fees", () => {
    const say = (highest: boolean | null, equal: boolean, lang: "en" | "sw" = "en") =>
      reasonSentence("full_payer", { ...NO_FACTS, highest, equal }, lang)
    expect(say(true, false)).toBe("Pays the full fee: the highest fee in the group.")
    expect(say(true, true)).toBe("Pays the full fee. The fees are equal, and this student came first.")
    expect(say(true, true, "sw")).toBe("Analipa ada kamili. Ada zinalingana, na mwanafunzi huyu alitangulia.")
    expect(say(false, false)).toBe("Pays the full fee. A sibling who joined later has a higher fee and gets the 10%.")
    expect(say(null, false)).toBe("Pays the full fee for the group.")
  })

  test("names in the sentence, and lists of names", () => {
    expect(reasonSentence("anchor", { ...NO_FACTS, siblings: ["Salma"] }, "en")).toBe("Sibling 10%, because Salma is already Enrolled.")
    expect(reasonSentence("enrolled_ten_anchor", { ...NO_FACTS, siblings: ["Salma", "Neema", "Hamisi"] }, "sw")).toBe(
      "Amesajiliwa na punguzo la 10%, kwa sababu Salma, Neema na Hamisi ameshasajiliwa.",
    )
    expect(reasonSentence("full_payer_sibling", { ...NO_FACTS, fullPayer: "Khalid" }, "en")).toBe("Sibling 10%, because Khalid pays the full fee.")
    expect(reasonSentence("request_pending", NO_FACTS, "en")).toBe("Full fee for now. A Sibling request waits for the Admissions Manager.")
    expect(reasonSentence("request_pending", { ...NO_FACTS, siblings: ["Latifa"] }, "en")).toBe(
      "Full fee for now. A Sibling request with Latifa waits for the Admissions Manager.",
    )
    expect(reasonSentence("closed", { ...NO_FACTS, closure: "Archived" }, "en")).toBe("Marked Archived, so not counted as a sibling.")
  })

  test("a fee set by hand names who and why only for staff who see fees", () => {
    const seen = { ...NO_FACTS, staff: "Example Staff Two", date: "18 Nov 2026", reason: "sibling_proof_after_enrolment" as const }
    expect(reasonSentence("manual_ten", seen, "en")).toBe(
      "Sibling 10%, set by hand by Example Staff Two on 18 Nov 2026. Reason: Sibling proof after enrolment.",
    )
    expect(reasonSentence("manual_ten", seen, "sw")).toBe(
      "Punguzo la ndugu 10%, limewekwa kwa mkono na Example Staff Two tarehe 18 Nov 2026. Sababu: Uthibitisho wa undugu baada ya kusajiliwa.",
    )
    expect(reasonSentence("manual_full", NO_FACTS, "en")).toBe("Full fee, set by hand by staff who record payments.")
  })

  test("a note the reason already says is left out", () => {
    expect(noteLines("prior_sibling", ["prior_sibling_tick", "grants_paused"], NO_FACTS, "en").map((n) => n.note)).toEqual(["grants_paused"])
    expect(noteLines("request_pending", ["request_pending"], NO_FACTS, "en")).toEqual([])
    expect(noteLines("full_payer_sibling", ["request_pending"], NO_FACTS, "en").map((n) => n.note)).toEqual(["request_pending"])
  })
})

describe("the fee chip", () => {
  const chip = (reason: SiblingReason, result: "full" | "ten" | "none", status = "Visited", larger: "staff_child" | null = null) =>
    feeChip({ reason, result, status, largerDiscount: larger }, "en")

  test("says what the student pays now", () => {
    expect(chip("full_payer_sibling", "ten")).toEqual({ text: "Sibling 10%", tone: "ok" })
    expect(chip("full_payer", "full")).toEqual({ text: "Full fee", tone: "line" })
    expect(chip("request_pending", "full")).toEqual({ text: "Full fee for now", tone: "wait" })
    // An Enrolled student's fee is fixed, so not "for now".
    expect(chip("request_pending", "full", "Enrolled")).toEqual({ text: "Full fee", tone: "line" })
    expect(chip("declined", "none")).toEqual({ text: "Not counted", tone: "line" })
    expect(chip("anchor", "ten", "Visited", "staff_child")).toEqual({ text: "Staff child 25%", tone: "ok" })
    expect(feeChip({ reason: "full_payer_sibling", result: "ten", status: "Visited", largerDiscount: null }, "sw").text).toBe("Punguzo la ndugu 10%")
  })
})

describe("the group view", () => {
  const member = (over: Partial<SiblingMemberExplanation> & Pick<SiblingMemberExplanation, "leadId" | "studentName" | "reason">): SiblingMemberExplanation => ({
    className: "STD 4",
    status: "Visited",
    leadOpen: true,
    legacy: false,
    basis: "matched",
    siblingOfLeadId: null,
    fullPayer: false,
    result: "full",
    source: "auto",
    lockedResult: null,
    notes: [],
    becauseOf: [],
    pendingRequest: null,
    decidedRequest: null,
    largerDiscount: null,
    highestFee: null,
    feeEdit: null,
    ...over,
  })
  const extras: SiblingViewExtras = { names: {}, closures: {}, priorSiblings: {}, fullPayerTie: true, formatDate: () => "18 Nov 2026" }

  test("names the full payer by first name, says the fees are equal, and marks this student", () => {
    const group: SiblingGroupExplanation = {
      leadId: "b",
      groupId: "g",
      allLegacy: false,
      fullPayerLeadId: "a",
      anchors: [],
      grantsPaused: false,
      members: [
        member({ leadId: "a", studentName: "Khalid Ali Khamis", reason: "full_payer", fullPayer: true, highestFee: true }),
        member({ leadId: "b", studentName: "Zuhura Ali Khamis", reason: "full_payer_sibling", becauseOf: ["a"], result: "ten" }),
        member({ leadId: "c", studentName: "Bakari Rashidi Said", reason: "request_pending", basis: "request_needed", becauseOf: ["x"], notes: ["request_pending"] }),
      ],
    }
    const view = describeSiblingGroup(group, { ...extras, names: { x: "Latifa Omari Hassan" } }, "b")
    expect(view.map((m) => m.sentence.en)).toEqual([
      "Pays the full fee. The fees are equal, and this student came first.",
      "Sibling 10%, because Khalid pays the full fee.",
      "Full fee for now. A Sibling request with Latifa waits for the Admissions Manager.",
    ])
    expect(view[1]).toMatchObject({ here: true, meta: "STD 4 · Visited · same father’s name · this student", firstName: "Zuhura" })
    expect(view[2].meta).toBe("STD 4 · Visited · fathers’ names don’t match")
    // The waiting request is the reason, so its note is not repeated.
    expect(view[2].notes).toEqual([])
  })

  test("paused grants: the pause is the sentence and the tag says full fee for now, never the held-back 10%", () => {
    const group: SiblingGroupExplanation = {
      leadId: "b",
      groupId: "g",
      allLegacy: false,
      fullPayerLeadId: "a",
      anchors: [],
      grantsPaused: true,
      members: [
        member({ leadId: "a", studentName: "Khalid Ali Khamis", reason: "full_payer", fullPayer: true }),
        member({ leadId: "b", studentName: "Rashidi Ali Khamis", reason: "full_payer_sibling", becauseOf: ["a"], result: "none", notes: ["grants_paused"] }),
      ],
    }
    const paused = describeSiblingGroup(group, extras, "b")[1]
    expect(paused.sentence).toEqual({
      en: "New Sibling 10% grants are paused, so this student pays the full fee for now.",
      sw: "Punguzo jipya la ndugu 10% limesimamishwa, kwa hiyo mwanafunzi huyu analipa ada kamili kwa sasa.",
    })
    expect(paused.chip.en).toEqual({ text: "Full fee for now", tone: "wait" })
    expect(paused.notes).toEqual([])
  })

  test("no other sibling counts: the lone member says so; a ticked sibling is named", () => {
    const group: SiblingGroupExplanation = {
      leadId: "a",
      groupId: "g",
      allLegacy: false,
      fullPayerLeadId: null,
      anchors: [],
      grantsPaused: false,
      members: [
        member({ leadId: "a", studentName: "Latifa Omari Hassan", reason: "no_full_payer" }),
        member({ leadId: "b", studentName: "Bakari Rashidi Said", reason: "request_needed", basis: "request_needed" }),
      ],
    }
    expect(describeSiblingGroup(group, extras, "a")[0].sentence.en).toBe("Full fee for now: no other sibling counts yet.")

    const alone: SiblingGroupExplanation = { ...group, groupId: null, members: [member({ leadId: "c", studentName: "Amani Daudi Petro", reason: "prior_sibling", basis: null, result: "ten" })] }
    const view = describeSiblingGroup(alone, { ...extras, priorSiblings: { c: "Daudi Amani Petro, STD 6" } }, "c")
    expect(view[0].sentence.en).toBe("Sibling 10%: has a sibling already at Al-Rahmah (Daudi Amani Petro, STD 6).")
    expect(view[0].meta).toBe("STD 4 · Visited")
  })
})
