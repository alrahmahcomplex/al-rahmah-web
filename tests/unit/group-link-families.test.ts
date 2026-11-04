import { describe, expect, it } from "vitest"

import { familiesInvitedText, familiesWarning } from "@/app/staff/group-links/families-text"

describe("families invited", () => {
  it("counts families, never members", () => {
    expect(familiesInvitedText(0)).toBe("0 families invited, not group members.")
    expect(familiesInvitedText(1)).toBe("1 family invited, not group members.")
    expect(familiesInvitedText(1012)).toBe("1,012 families invited, not group members.")
  })

  it("warns from 900 families, before WhatsApp's 1,024-member limit", () => {
    expect(familiesWarning(899)).toBeNull()
    expect(familiesWarning(900)).toContain("1,024-member limit")
    expect(familiesWarning(1100)).toContain("Open a second group")
  })
})
