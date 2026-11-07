import { describe, expect, it } from "vitest"

import { auditChanges, auditFilters, auditHref, auditValue } from "@/lib/services/system-audit"

// The Super Admin's audit screen (#237): its filters from the query string,
// its page links, and how an entry's fields read.

describe("auditFilters", () => {
  it("keeps well-formed filters", () => {
    expect(
      auditFilters({ from: "2026-11-01", to: "2026-11-07", actor: "system", area: "payment", record: "ADMSN-90001", page: "3" }),
    ).toEqual({ from: "2026-11-01", to: "2026-11-07", actor: "system", area: "payment", record: "ADMSN-90001", page: 3 })
  })

  it("drops malformed dates, an unknown area and a bad page, so a hand-edited link shows everything", () => {
    expect(auditFilters({ from: "yesterday", to: "2026-13", area: "everything", page: "-2", record: "  " })).toEqual({
      from: undefined,
      to: undefined,
      actor: undefined,
      area: undefined,
      record: undefined,
      page: 1,
    })
  })

  it("takes the first of a repeated parameter", () => {
    expect(auditFilters({ area: ["lead", "payment"] }).area).toBe("lead")
  })
})

describe("auditHref", () => {
  it("carries the filters and leaves page 1 out", () => {
    expect(auditHref({ area: "lead", record: "ADMSN-90001" }, 1)).toBe("/staff/audit?area=lead&record=ADMSN-90001")
    expect(auditHref({ actor: "system" }, 2)).toBe("/staff/audit?actor=system&page=2")
    expect(auditHref({}, 1)).toBe("/staff/audit")
  })
})

describe("auditChanges", () => {
  it("lists an update's changed fields from old to new", () => {
    expect(auditChanges({ action: "update", oldValues: { status: "Applied" }, newValues: { status: "Visited" } })).toEqual([
      { field: "status", from: "Applied", to: "Visited" },
    ])
  })

  it("lists an insert's or an action's values with no earlier value", () => {
    expect(auditChanges({ action: "invite_sent", oldValues: null, newValues: { email: "a@example.test", count: 2 } })).toEqual([
      { field: "email", from: null, to: "a@example.test" },
      { field: "count", from: null, to: "2" },
    ])
  })

  it("reads an empty value as empty and anything else as stored", () => {
    expect(auditValue(null)).toBe("empty")
    expect(auditValue({ a: 1 })).toBe('{"a":1}')
  })
})
