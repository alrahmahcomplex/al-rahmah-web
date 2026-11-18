import { describe, expect, it } from "vitest"

import { feeEditRefusal, feeWhy, keepFeeRefusal, setByHandLine } from "@/app/staff/applicants/[id]/fee-edit-outcome"
import { leadsHref, parseLeadSearch } from "@/app/staff/applicants/search-params"
import { memberChip } from "@/lib/sibling-group-view"
import type { SiblingMemberExplanation } from "@/lib/services/sibling-counts"

// The Accountant's Sibling fee edit and the Applicants Sibling column (#311):
// the words the screen derives from what the database answers.

describe("feeWhy", () => {
  it("names the fee after its discount, the larger discounts by their amount", () => {
    expect(feeWhy(null)).toBe("Full fee")
    expect(feeWhy("sibling")).toBe("Sibling 10%")
    expect(feeWhy("staff_child")).toBe("Staff child 25%")
    expect(feeWhy("qualified_orphan")).toBe("Qualified orphan 100%")
  })
})

describe("setByHandLine", () => {
  it("says who set the fee by hand, when, why, and the note when there is one", () => {
    const setByHand = { staff: "Example Staff Two", date: "18 Nov 2026", reason: "Sibling proof after enrolment", note: null }
    expect(setByHandLine({ setByHand })).toBe("set by hand by Example Staff Two on 18 Nov 2026 · Sibling proof after enrolment")
    expect(setByHandLine({ setByHand: { ...setByHand, note: "Certificates seen" } })).toBe(
      "set by hand by Example Staff Two on 18 Nov 2026 · Sibling proof after enrolment · Certificates seen",
    )
    expect(setByHandLine({ setByHand: null })).toBeNull()
  })
})

describe("the refusals", () => {
  it("uses the prototype's words for the form's own mistakes", () => {
    expect(feeEditRefusal({ kind: "unchanged" }, "save").message).toBe("Nothing would change.")
    expect(feeEditRefusal({ kind: "invalid", field: "reason" }, "save").message).toBe("Choose the reason.")
    expect(feeEditRefusal({ kind: "invalid", field: "value" }, "save").message).toBe("Choose the fee.")
    expect(keepFeeRefusal("invalid").message).toBe("Write why the fee stays as it is.")
  })

  it("says nothing was changed when a save fails, and a preview failure says it couldn't be worked out", () => {
    expect(feeEditRefusal({ kind: "unavailable" }, "save").message).toMatch(/Nothing was changed/)
    expect(feeEditRefusal({ kind: "request-reused" }, "save").message).toMatch(/Nothing was changed/)
    expect(feeEditRefusal({ kind: "unavailable" }, "preview").message).toMatch(/could not be worked out/)
  })
})

function member(changes: Partial<SiblingMemberExplanation>): SiblingMemberExplanation {
  return {
    leadId: "l",
    studentName: "Neema Juma Mrisho",
    className: "STD 5",
    status: "Interviewed",
    leadOpen: true,
    legacy: false,
    basis: "matched",
    siblingOfLeadId: null,
    fullPayer: false,
    result: "ten",
    source: "auto",
    lockedResult: null,
    reason: "anchor",
    notes: [],
    becauseOf: [],
    pendingRequest: null,
    decidedRequest: null,
    largerDiscount: null,
    highestFee: null,
    feeEdit: null,
    ...changes,
  }
}

describe("memberChip", () => {
  it("is the fee tag, held back to Full fee for now while new grants are paused", () => {
    expect(memberChip(member({}), "en")).toEqual({ text: "Sibling 10%", tone: "ok" })
    expect(memberChip(member({ notes: ["grants_paused"], result: "none" }), "en")).toEqual({ text: "Full fee for now", tone: "wait" })
    // Enrolled, or holding a larger discount, the pause changes nothing.
    expect(memberChip(member({ notes: ["grants_paused"], status: "Enrolled" }), "en")).toEqual({ text: "Sibling 10%", tone: "ok" })
    expect(memberChip(member({ notes: ["grants_paused"], largerDiscount: "staff_child" }), "sw").text).toBe("Punguzo la mtoto wa mfanyakazi 25%")
  })
})

describe("the Sibling follow-up list in the URL", () => {
  it("reads a known follow-up and ignores anything else", () => {
    expect(parseLeadSearch({ sibling: "fee_edit_needed" }).siblingFollowUp).toBe("fee_edit_needed")
    expect(parseLeadSearch({ sibling: "everyone" }).siblingFollowUp).toBeUndefined()
  })

  it("keeps it when paging", () => {
    expect(leadsHref({ siblingFollowUp: "not_known", closure: "open", page: 1 }, { page: 2 })).toBe("/staff/applicants?sibling=not_known&page=2")
  })
})
