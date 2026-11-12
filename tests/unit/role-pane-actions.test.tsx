import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  addRole: vi.fn(),
  correctStaffMemberName: vi.fn(),
  deactivateStaffMember: vi.fn(),
  inviteStaffMember: vi.fn(),
  moveStaffMember: vi.fn(),
  reactivateRoleNow: vi.fn(),
  reactivateStaffMember: vi.fn(),
  renameRoleTo: vi.fn(),
  resendStaffInvite: vi.fn(),
  retireRoleNow: vi.fn(),
  sendStaffResetLink: vi.fn(),
  setManagedRole: vi.fn(),
  setPermission: vi.fn(),
}))
vi.mock("@/app/staff/roles/actions", () => actions)
const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { NewRoleForm } from "@/app/staff/roles/new-role-form"
import { RolePane } from "@/app/staff/roles/role-pane"
import type { PersonView, RoleView } from "@/app/staff/roles/view"
import type { PermissionOption } from "@/lib/services/staff-admin"

// The redesign (#331) restyled every control on Staff and roles. These
// check that each one still calls the same server action with the same
// arguments, and asks first where it asked before.

const PERMISSIONS: PermissionOption[] = [
  { name: "leads.view", label: "View applicants and their history" },
  { name: "payments.record", label: "Record payments and maintain fees" },
]

const person = (overrides: Partial<PersonView>): PersonView => ({
  id: "p-1",
  name: "Asha Fixture",
  email: "asha@example.test",
  active: true,
  status: "Active",
  canResendInvite: false,
  canSendReset: true,
  isYou: false,
  managesStaff: false,
  moveTargets: [
    { id: "r-acc", name: "Accountant", managesStaff: false },
    { id: "r-boss", name: "Head Office", managesStaff: true },
  ],
  moveBlocked: null,
  deactivateBlocked: null,
  reactivateBlocked: null,
  ...overrides,
})

const ROLE: RoleView = {
  id: "r-man",
  name: "Admissions Manager",
  permissions: ["leads.view"],
  retired: false,
  activeHolders: 2,
  manages: ["r-staff"],
  isYours: false,
  canEditRoles: true,
  editable: true,
  managed: true,
  managesStaff: true,
  managesNames: ["Admissions Staff"],
  managedOptions: [
    { id: "r-staff", name: "Admissions Staff", checked: true, retired: false },
    { id: "r-acc", name: "Accountant", checked: false, retired: false },
  ],
  retireBlocked: null,
  inviteBlocked: null,
  subtitle: "Changes apply to everyone in this role immediately.",
  people: [
    person({}),
    person({ id: "p-2", name: "Baraka Lead", email: "baraka@example.test", managesStaff: true }),
    person({ id: "p-3", name: "Chausiku Gone", email: "chausiku@example.test", active: false, status: "Deactivated", canSendReset: false }),
    person({ id: "p-4", name: "Dua Invited", email: "dua@example.test", status: "Invited", canResendInvite: true, canSendReset: false }),
  ],
}

const OK = { ok: true, message: "Done." }

function renderPane(role: RoleView = ROLE) {
  return render(
    <RolePane role={role} permissions={PERMISSIONS}>
      {null}
    </RolePane>,
  )
}

const row = (name: string) => screen.getByRole("listitem", { name })

// Every control is disabled while a change is on its way, as before the
// redesign; wait for the pane to be idle before the next click.
const idle = () => waitFor(() => expect(screen.getByRole("button", { name: "Rename", hidden: true })).toBeEnabled())

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset().mockResolvedValue(OK)
  push.mockReset()
})

describe("Staff and roles controls", () => {
  it("grants and revokes a permission with the tick boxes", async () => {
    const user = userEvent.setup()
    renderPane()

    await user.click(screen.getByRole("checkbox", { name: "Record payments and maintain fees" }))
    await waitFor(() => expect(actions.setPermission).toHaveBeenCalledWith("r-man", "payments.record", true))
    await idle()

    await user.click(screen.getByRole("checkbox", { name: "View applicants and their history" }))
    await waitFor(() => expect(actions.setPermission).toHaveBeenCalledWith("r-man", "leads.view", false))
    await idle()
    expect(actions.setPermission).toHaveBeenCalledTimes(2)
  })

  it("adds and removes a role from the managed set", async () => {
    const user = userEvent.setup()
    renderPane()

    await user.click(screen.getByRole("checkbox", { name: "Accountant" }))
    await waitFor(() => expect(actions.setManagedRole).toHaveBeenCalledWith("r-man", "r-acc", true))
    await idle()
    await user.click(screen.getByRole("checkbox", { name: "Admissions Staff" }))
    await waitFor(() => expect(actions.setManagedRole).toHaveBeenCalledWith("r-man", "r-staff", false))
    await idle()
  })

  it("moves someone at once, or asks first when they would stop managing staff", async () => {
    const user = userEvent.setup()
    renderPane()

    await user.click(within(row("Asha Fixture")).getByRole("button", { name: "Move to…" }))
    await user.click(within(screen.getByRole("dialog", { name: "Move to…" })).getByRole("button", { name: "Accountant" }))
    await waitFor(() => expect(actions.moveStaffMember).toHaveBeenCalledWith("p-1", "r-acc"))
    await idle()

    await user.click(within(row("Baraka Lead")).getByRole("button", { name: "Move to…" }))
    await user.click(within(screen.getByRole("dialog", { name: "Move to…" })).getByRole("button", { name: "Accountant" }))
    const confirm = await screen.findByRole("dialog", { name: "Move Baraka Lead to Accountant?" })
    expect(actions.moveStaffMember).toHaveBeenCalledTimes(1)
    await user.click(within(confirm).getByRole("button", { name: "Move" }))
    await waitFor(() => expect(actions.moveStaffMember).toHaveBeenCalledWith("p-2", "r-acc"))
    await idle()
  })

  it("deactivates at once, or asks first for someone who manages staff, and Cancel changes nothing", async () => {
    const user = userEvent.setup()
    renderPane()

    await user.click(within(row("Asha Fixture")).getByRole("button", { name: "Deactivate" }))
    await waitFor(() => expect(actions.deactivateStaffMember).toHaveBeenCalledWith("p-1"))
    await idle()

    await user.click(within(row("Baraka Lead")).getByRole("button", { name: "Deactivate" }))
    const confirm = await screen.findByRole("dialog", { name: "Deactivate Baraka Lead?" })
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }))
    expect(actions.deactivateStaffMember).toHaveBeenCalledTimes(1)

    await user.click(within(row("Baraka Lead")).getByRole("button", { name: "Deactivate" }))
    await user.click(within(await screen.findByRole("dialog", { name: "Deactivate Baraka Lead?" })).getByRole("button", { name: "Deactivate" }))
    await waitFor(() => expect(actions.deactivateStaffMember).toHaveBeenCalledWith("p-2"))
    await idle()
  })

  it("reactivates, resends an invite and sends a reset link for the right person", async () => {
    const user = userEvent.setup()
    renderPane()

    await user.click(within(row("Chausiku Gone")).getByRole("button", { name: "Reactivate" }))
    await waitFor(() => expect(actions.reactivateStaffMember).toHaveBeenCalledWith("p-3"))
    await idle()
    await user.click(within(row("Dua Invited")).getByRole("button", { name: "Resend invite" }))
    await waitFor(() => expect(actions.resendStaffInvite).toHaveBeenCalledWith("p-4"))
    await idle()
    await user.click(within(row("Asha Fixture")).getByRole("button", { name: "Send reset link" }))
    await waitFor(() => expect(actions.sendStaffResetLink).toHaveBeenCalledWith("p-1"))
    await idle()
  })

  it("retires a role only after the confirmation, and reactivates a retired one", async () => {
    const user = userEvent.setup()
    const { unmount } = renderPane()

    await user.click(screen.getByRole("button", { name: "Retire role" }))
    const confirm = await screen.findByRole("dialog", { name: "Retire Admissions Manager?" })
    expect(actions.retireRoleNow).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole("button", { name: "Retire role" }))
    await waitFor(() => expect(actions.retireRoleNow).toHaveBeenCalledWith("r-man"))
    await idle()
    unmount()

    renderPane({ ...ROLE, retired: true })
    await user.click(screen.getByRole("button", { name: "Reactivate role" }))
    await waitFor(() => expect(actions.reactivateRoleNow).toHaveBeenCalledWith("r-man"))
  })

  it("renames the role and corrects a name with what was typed, keeping a refusal in the sheet", async () => {
    const user = userEvent.setup()
    actions.renameRoleTo.mockResolvedValueOnce({ ok: false, message: 'A role called "accountant" already exists.' })
    renderPane()

    await user.click(screen.getByRole("button", { name: "Rename" }))
    let sheet = await screen.findByRole("dialog", { name: "Rename Admissions Manager" })
    const field = within(sheet).getByLabelText("Role name")
    await user.clear(field)
    await user.type(field, "accountant")
    await user.click(within(sheet).getByRole("button", { name: "Save name" }))
    await waitFor(() => expect(actions.renameRoleTo).toHaveBeenCalledWith("r-man", "accountant"))
    await idle()
    await waitFor(() => expect(within(sheet).getByRole("alert")).toHaveTextContent('A role called "accountant" already exists.'))

    await user.clear(field)
    await user.type(field, "Admissions Lead")
    await user.click(within(sheet).getByRole("button", { name: "Save name" }))
    await waitFor(() => expect(actions.renameRoleTo).toHaveBeenLastCalledWith("r-man", "Admissions Lead"))
    await idle()

    await user.click(within(row("Asha Fixture")).getByRole("button", { name: "Correct name" }))
    sheet = await screen.findByRole("dialog", { name: "Correct Asha Fixture's name" })
    const name = within(sheet).getByLabelText("Full name")
    await user.clear(name)
    await user.type(name, "Asha Fixture Corrected")
    await user.click(within(sheet).getByRole("button", { name: "Save name" }))
    await waitFor(() => expect(actions.correctStaffMemberName).toHaveBeenCalledWith("p-1", "Asha Fixture Corrected"))
    await idle()
  })

  it("invites with the role in view and the typed name and email", async () => {
    const user = userEvent.setup()
    actions.inviteStaffMember.mockResolvedValue({ ...OK, created: true })
    renderPane()

    const form = screen.getByRole("form", { name: "Invite someone to Admissions Manager" })
    await user.type(within(form).getByLabelText("Full name"), "Neema Invitee")
    await user.type(within(form).getByLabelText("Email"), "neema@example.test")
    await user.click(within(form).getByRole("button", { name: "Send invite" }))
    await waitFor(() => expect(actions.inviteStaffMember).toHaveBeenCalledWith("r-man", "Neema Invitee", "neema@example.test"))
    await idle()
  })
})

describe("New role", () => {
  it("adds a blank role with the typed name, and a template's role under the template's name", async () => {
    const user = userEvent.setup()
    actions.addRole.mockResolvedValue({ ok: true, message: "Added.", roleId: "r-new" })
    render(<NewRoleForm />)

    await user.type(screen.getByLabelText("Role name"), "Gatekeepers")
    await user.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() => expect(actions.addRole).toHaveBeenCalledWith("Gatekeepers", null))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff/roles?role=r-new"))

    await user.selectOptions(screen.getByLabelText("Start from"), "Admissions Manager")
    expect(screen.getByLabelText("Role name")).toHaveValue("Admissions Manager")
    await user.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(actions.addRole).toHaveBeenLastCalledWith("Admissions Manager", "Admissions Manager"))
  })
})
