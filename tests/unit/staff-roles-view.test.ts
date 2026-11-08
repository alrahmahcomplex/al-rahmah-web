import { describe, expect, it } from "vitest"

import { roleView, type Viewer } from "@/app/staff/roles/view"
import type { StaffAndRoles } from "@/lib/services/staff-admin"

// The roles as Staff and roles reads them: the Administrator manages the
// Manager, the Manager manages Admissions Staff (#241).
const DATA: StaffAndRoles = {
  permissions: [],
  roles: [
    { id: "admin", name: "Administrator", permissions: ["leads.view"], retired: false, activeHolders: 1, manages: ["manager"] },
    { id: "manager", name: "Admissions Manager", permissions: ["leads.view"], retired: false, activeHolders: 2, manages: ["staff"] },
    { id: "staff", name: "Admissions Staff", permissions: ["leads.view", "leads.edit"], retired: false, activeHolders: 2, manages: [] },
    { id: "accountant", name: "Accountant", permissions: ["payments.view"], retired: false, activeHolders: 1, manages: [] },
    { id: "receptionist", name: "Receptionist", permissions: ["leads.view"], retired: true, activeHolders: 0, manages: [] },
  ],
  staff: [
    { id: "me", name: "Amina Juma", email: "amina@example.test", roleId: "manager", active: true, invited: false },
    { id: "other", name: "Baraka Said", email: "baraka@example.test", roleId: "manager", active: true, invited: false },
    { id: "rehema", name: "Rehema Ali", email: "rehema@example.test", roleId: "staff", active: true, invited: false },
    { id: "juma", name: "Juma Ali", email: "juma@example.test", roleId: "staff", active: true, invited: true },
    { id: "neema", name: "Neema Mushi", email: "neema@example.test", roleId: "accountant", active: true, invited: false },
    { id: "salma", name: "Salma Kombo", email: "salma@example.test", roleId: "receptionist", active: false, invited: false },
  ],
}

const SUPER_ADMIN: Viewer = { id: "sa", superAdmin: true, managedRoleIds: [] }
const MANAGER: Viewer = { id: "me", superAdmin: false, managedRoleIds: ["staff"] }
const ADMINISTRATOR: Viewer = { id: "boss", superAdmin: false, managedRoleIds: ["manager"] }

describe("roleView for the Super Admin", () => {
  it("opens every current role to editing and its managed set to change", () => {
    const view = roleView(DATA, "manager", SUPER_ADMIN)!

    expect(view).toMatchObject({ canEditRoles: true, editable: true, managed: true, managesStaff: true })
    expect(view.subtitle).toBe("Changes apply to everyone in this role immediately.")
    expect(view.managedOptions).toEqual([
      { id: "admin", name: "Administrator", checked: false, retired: false },
      { id: "staff", name: "Admissions Staff", checked: true, retired: false },
      { id: "accountant", name: "Accountant", checked: false, retired: false },
    ])
  })

  it("shows each person as Active, Invited or Deactivated, offering a resend only to the Invited and a reset only to the Active", () => {
    const people = roleView(DATA, "staff", SUPER_ADMIN)!.people
    const salma = roleView(DATA, "receptionist", SUPER_ADMIN)!.people[0]

    expect(people.map((p) => [p.name, p.status, p.canResendInvite, p.canSendReset])).toEqual([
      ["Juma Ali", "Invited", true, false],
      ["Rehema Ali", "Active", false, true],
    ])
    expect([salma.status, salma.canResendInvite, salma.canSendReset]).toEqual(["Deactivated", false, false])
  })

  it("moves anyone to any other current role, confirming when they stop managing staff", () => {
    const other = roleView(DATA, "manager", SUPER_ADMIN)!.people.find((p) => p.id === "other")!

    expect(other).toMatchObject({ managesStaff: true, moveBlocked: null, deactivateBlocked: null })
    expect(other.moveTargets).toEqual([
      { id: "admin", name: "Administrator", managesStaff: true },
      { id: "staff", name: "Admissions Staff", managesStaff: false },
      { id: "accountant", name: "Accountant", managesStaff: false },
    ])
  })

  it("keeps a retired role closed to editing but open to reactivation, and blocks reactivating its people", () => {
    const view = roleView(DATA, "receptionist", SUPER_ADMIN)!

    expect(view).toMatchObject({ canEditRoles: true, editable: false, retireBlocked: null })
    expect(view.subtitle).toBe("Retired. Kept for history. Reactivate it to give it to anyone again.")
    expect(view.inviteBlocked).toBe('"Receptionist" is retired, so nobody can be given it.')
    expect(view.people[0]).toMatchObject({
      active: false,
      reactivateBlocked: 'Salma Kombo\'s role "Receptionist" was retired. Give them a current role first, then reactivate.',
    })
  })

  it("blocks retiring a role active staff hold, naming them, and allows it once only deactivated staff hold it", () => {
    expect(roleView(DATA, "accountant", SUPER_ADMIN)!.retireBlocked).toBe(
      "Accountant is still held by Neema Mushi. Move them to another role first.",
    )
    const data: StaffAndRoles = { ...DATA, staff: DATA.staff.map((s) => (s.id === "neema" ? { ...s, active: false } : s)) }
    expect(roleView(data, "accountant", SUPER_ADMIN)).toMatchObject({ editable: true, retireBlocked: null })
  })

  it("offers a retired role in the managed set only while it is still in it", () => {
    const data: StaffAndRoles = {
      ...DATA,
      roles: DATA.roles.map((r) => (r.id === "accountant" ? { ...r, manages: ["receptionist"] } : r)),
    }
    expect(roleView(data, "accountant", SUPER_ADMIN)!.managedOptions.find((o) => o.id === "receptionist")).toEqual({
      id: "receptionist",
      name: "Receptionist",
      checked: true,
      retired: true,
    })
    expect(roleView(DATA, "accountant", SUPER_ADMIN)!.managedOptions.map((o) => o.id)).not.toContain("receptionist")
  })
})

describe("roleView for a role with a managed set", () => {
  it("shows the people in a managed role with their actions, and moves only inside the set", () => {
    const view = roleView(DATA, "staff", MANAGER)!

    expect(view).toMatchObject({ canEditRoles: false, editable: false, managed: true, managedOptions: [] })
    expect(view.subtitle).toBe("You manage the staff in this role. Only the Super Admin changes what it can do.")
    expect(view.inviteBlocked).toBeNull()
    const rehema = view.people.find((p) => p.id === "rehema")!
    // Admissions Staff is the Manager's only role, so there is nowhere to move anyone.
    expect(rehema).toMatchObject({
      moveTargets: [],
      moveBlocked: "There is no other current role you manage to move them to.",
      deactivateBlocked: null,
    })
  })

  it("shows a role it doesn't manage read-only, with nobody listed and no invite", () => {
    const view = roleView(DATA, "accountant", MANAGER)!

    expect(view).toMatchObject({ canEditRoles: false, editable: false, managed: false, people: [] })
    expect(view.subtitle).toBe("Your role doesn't manage the staff in this role. Only the Super Admin changes roles.")
  })

  it("shows the viewer's own role read-only, naming what it manages", () => {
    const view = roleView(DATA, "manager", MANAGER)!

    expect(view).toMatchObject({ isYours: true, managed: false, people: [], managesNames: ["Admissions Staff"] })
    expect(view.subtitle).toBe("This is your role. Only the Super Admin changes it.")
  })

  it("lets an Administrator manage a fellow Manager, but not themselves", () => {
    const data: StaffAndRoles = {
      ...DATA,
      staff: [...DATA.staff, { id: "boss", name: "Zuhura Bakari", email: "zuhura@example.test", roleId: "admin", active: true, invited: false }],
    }
    const other = roleView(data, "manager", ADMINISTRATOR)!.people.find((p) => p.id === "other")!
    expect(other).toMatchObject({ managesStaff: true, moveTargets: [], deactivateBlocked: null })

    const own = roleView(data, "admin", { ...ADMINISTRATOR, managedRoleIds: ["manager", "admin"] })!.people[0]
    expect(own).toMatchObject({
      isYou: true,
      moveBlocked: "You can't change your own role. The Super Admin, or someone whose role manages yours, has to do it.",
      deactivateBlocked: "You can't deactivate yourself.",
    })
  })
})

describe("roleView", () => {
  it("is empty for a role that does not exist", () => {
    expect(roleView(DATA, "missing", SUPER_ADMIN)).toBeNull()
  })
})
