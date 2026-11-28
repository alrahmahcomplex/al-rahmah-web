import { describe, expect, it } from "vitest"

import {
  changeCount,
  draftChanges,
  EMPTY_DRAFT,
  selectManaged,
  selectPermission,
  shownManaged,
  shownPermissions,
} from "@/app/staff/roles/draft"
import type { Permission } from "@/lib/permissions"

// The Roles page's unsaved changes (owner request of 2026-11-27): selecting
// a box changes only the draft; Save changes sends what differs from what's
// saved.

const ORDER: Permission[] = ["leads.view", "leads.decline", "results.send", "payments.view", "visits.record", "reports.view"]
const changes = (saved: Permission[], draft = EMPTY_DRAFT, savedManaged: string[] = [], managedOrder: string[] = []) =>
  draftChanges(saved, ORDER, savedManaged, managedOrder, draft)

describe("the Roles draft", () => {
  it("adds and takes away boxes, in the order they are listed", () => {
    const saved: Permission[] = ["leads.view", "results.send"]
    let draft = selectPermission(saved, EMPTY_DRAFT, "results.send", false)
    draft = selectPermission(saved, draft, "leads.decline", true)
    expect(shownPermissions(saved, draft)).toEqual(["leads.view", "leads.decline"])
    expect(changes(saved, draft)).toEqual({ addPermissions: ["leads.decline"], removePermissions: ["results.send"], addManaged: [], removeManaged: [] })
    expect(changeCount(changes(saved, draft))).toBe(2)
  })

  it("forgets a box put back the way it was saved", () => {
    const saved: Permission[] = ["leads.view"]
    const draft = selectPermission(saved, selectPermission(saved, EMPTY_DRAFT, "leads.view", false), "leads.view", true)
    expect(draft.permissions.size).toBe(0)
    expect(changeCount(changes(saved, draft))).toBe(0)
  })

  it("selects what a permission needs, and clears what needs a cleared one", () => {
    const draft = selectPermission([], EMPTY_DRAFT, "visits.record", true)
    expect(shownPermissions([], draft)).toEqual(["visits.record", "payments.view"])
    expect(changes([], draft).addPermissions).toEqual(["payments.view", "visits.record"])

    const saved: Permission[] = ["leads.view", "reports.view"]
    const cleared = selectPermission(saved, EMPTY_DRAFT, "leads.view", false)
    expect(shownPermissions(saved, cleared)).toEqual([])
    expect(changes(saved, cleared).removePermissions).toEqual(["leads.view", "reports.view"])
  })

  it("drops a change someone else's save already made", () => {
    const draft = selectPermission([], EMPTY_DRAFT, "leads.decline", true)
    // Their save added it too: after the refresh it is saved, so nothing is sent.
    expect(changeCount(changes(["leads.decline"], draft))).toBe(0)
  })

  it("keeps a pair together when someone else's save changes what's saved underneath", () => {
    // Reports selected while applicant access was saved; then another Super
    // Admin's save takes applicant access away. The boxes and Save both keep
    // the pair, as the database would.
    const draft = selectPermission(["leads.view"], EMPTY_DRAFT, "reports.view", true)
    expect(shownPermissions([], draft)).toEqual(["reports.view", "leads.view"])
    expect(changes([], draft).addPermissions).toEqual(["leads.view", "reports.view"])

    // Applicant access cleared here; meanwhile their save added Reports. Clearing
    // what Reports needs clears Reports too, on screen and in what's sent.
    const cleared = selectPermission(["leads.view"], EMPTY_DRAFT, "leads.view", false)
    expect(shownPermissions(["leads.view", "reports.view"], cleared)).toEqual([])
    expect(changes(["leads.view", "reports.view"], cleared).removePermissions).toEqual(["leads.view", "reports.view"])
  })

  it("adds and takes away managed roles the same way", () => {
    let draft = selectManaged(["r-a"], EMPTY_DRAFT, "r-a", false)
    draft = selectManaged(["r-a"], draft, "r-b", true)
    expect(shownManaged(["r-a"], draft)).toEqual(["r-b"])
    expect(changes([], draft, ["r-a"], ["r-a", "r-b"])).toEqual({ addPermissions: [], removePermissions: [], addManaged: ["r-b"], removeManaged: ["r-a"] })
  })
})
