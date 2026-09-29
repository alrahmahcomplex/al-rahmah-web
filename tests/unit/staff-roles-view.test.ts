import { describe, expect, it } from "vitest"

import { roleView } from "@/app/staff/roles/view"
import type { StaffAndRoles } from "@/lib/services/staff-admin"

const DATA: StaffAndRoles = {
  permissions: [],
  roles: [
    { id: "manager", name: "Admissions Manager", permissions: ["leads.view", "staff.administer"], retired: false, activeHolders: 2 },
    { id: "accountant", name: "Accountant", permissions: ["payments.view"], retired: false, activeHolders: 1 },
    { id: "receptionist", name: "Receptionist", permissions: ["leads.view"], retired: true, activeHolders: 0 },
  ],
  staff: [
    { id: "me", name: "Amina Juma", email: "amina@example.test", roleId: "manager", active: true },
    { id: "other", name: "Baraka Said", email: "baraka@example.test", roleId: "manager", active: true },
    { id: "neema", name: "Neema Mushi", email: "neema@example.test", roleId: "accountant", active: true },
    { id: "salma", name: "Salma Kombo", email: "salma@example.test", roleId: "receptionist", active: false },
  ],
}

describe("roleView", () => {
  it("marks the viewer's own role and blocks changing or deactivating themselves", () => {
    const view = roleView(DATA, "manager", "me")!

    expect(view.isYours).toBe(true)
    expect(view.subtitle).toBe("This is your role. Another Manager has to change it.")
    expect(view.people.find((p) => p.id === "me")).toMatchObject({
      isYou: true,
      moveBlocked: "You can't change your own role. Another Manager has to do it.",
      deactivateBlocked: "You can't deactivate yourself.",
    })
  })

  it("lets the viewer change a fellow administrator, who needs confirming", () => {
    const other = roleView(DATA, "manager", "me")!.people.find((p) => p.id === "other")!

    expect(other).toMatchObject({ administers: true, moveBlocked: null, deactivateBlocked: null })
    expect(other.moveTargets).toEqual([{ id: "accountant", name: "Accountant", administers: false }])
  })

  it("offers only current roles other than the one held", () => {
    const neema = roleView(DATA, "accountant", "me")!.people[0]

    expect(neema.administers).toBe(false)
    expect(neema.moveTargets.map((r) => r.id)).toEqual(["manager"])
  })

  it("blocks reactivating someone on a retired role, with the reason", () => {
    const view = roleView(DATA, "receptionist", "me")!

    expect(view.subtitle).toBe("Retired. Kept for history.")
    expect(view.people[0]).toMatchObject({
      active: false,
      reactivateBlocked: 'Salma Kombo\'s role "Receptionist" was retired. Give them a current role first, then reactivate.',
    })
  })

  it("says who can change a role that administers staff, when it is not the viewer's", () => {
    expect(roleView(DATA, "manager", "neema")!.subtitle).toBe(
      "Only a reviewed update to the system can change this role.",
    )
    expect(roleView(DATA, "accountant", "me")!.subtitle).toBe("Changes apply to everyone in this role immediately.")
  })

  it("closes to editing the viewer's role, a role that administers staff, and a retired role", () => {
    expect(roleView(DATA, "manager", "me")).toMatchObject({ editable: false, retireBlocked: null })
    expect(roleView(DATA, "manager", "neema")).toMatchObject({ editable: false, retireBlocked: null })
    expect(roleView(DATA, "receptionist", "me")).toMatchObject({ editable: false, retireBlocked: null })
  })

  it("keeps a role open to editing when nothing closes it", () => {
    expect(roleView(DATA, "accountant", "me")).toMatchObject({ editable: true })
  })

  it("blocks retiring a role active staff hold, naming them", () => {
    expect(roleView(DATA, "accountant", "me")!.retireBlocked).toBe(
      "Accountant is still held by Neema Mushi. Move them to another role first.",
    )
  })

  it("lets a role be retired once only deactivated staff hold it", () => {
    const data: StaffAndRoles = {
      ...DATA,
      staff: DATA.staff.map((s) => (s.id === "neema" ? { ...s, active: false } : s)),
    }

    expect(roleView(data, "accountant", "me")).toMatchObject({ editable: true, retireBlocked: null })
  })

  it("is empty for a role that does not exist", () => {
    expect(roleView(DATA, "missing", "me")).toBeNull()
  })
})
