import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import Link from "next/link"
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
  saveRole: vi.fn(),
  sendStaffResetLink: vi.fn(),
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
  subtitle: "Select what this role can do, then press Save changes. Everyone in the role gets the change on their next click.",
  people: [
    person({}),
    person({ id: "p-2", name: "Baraka Lead", email: "baraka@example.test", managesStaff: true }),
    person({ id: "p-3", name: "Chausiku Gone", email: "chausiku@example.test", active: false, status: "Deactivated", canSendReset: false }),
    person({ id: "p-4", name: "Dua Invited", email: "dua@example.test", status: "Invited", canResendInvite: true, canSendReset: false }),
  ],
}

const OK = { ok: true, message: "Done." }

function renderPane(role: RoleView = ROLE, permissions: PermissionOption[] = PERMISSIONS, children: React.ReactNode = null) {
  return render(
    <RolePane role={role} permissions={permissions}>
      {children}
    </RolePane>,
  )
}

const saveBar = () => screen.queryByRole("region", { name: "Unsaved changes" })

const row = (name: string) => screen.getByRole("listitem", { name })

// Every control is disabled while a change is on its way, as before the
// redesign; wait for the pane to be idle before the next click.
const idle = () => waitFor(() => expect(screen.getByRole("button", { name: "Rename", hidden: true })).toBeEnabled(), { timeout: 10_000 })

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset().mockResolvedValue(OK)
  push.mockReset()
})

describe("Staff and roles controls", () => {
  it("selecting boxes changes only the screen; Save changes sends every change in one call", async () => {
    const user = userEvent.setup()
    actions.saveRole.mockResolvedValue({ ok: true, message: "Saved 3 changes to Admissions Manager." })
    renderPane()
    expect(saveBar()).toBeNull()

    await user.click(screen.getByRole("checkbox", { name: "Record payments and maintain fees" }))
    await user.click(screen.getByRole("checkbox", { name: "View applicants and their history" }))
    await user.click(screen.getByRole("checkbox", { name: "Accountant" }))
    expect(actions.saveRole).not.toHaveBeenCalled()
    expect(screen.getByRole("checkbox", { name: "Record payments and maintain fees" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "View applicants and their history" })).not.toBeChecked()
    expect(within(saveBar()!).getByText("3 changes not saved")).toBeInTheDocument()
    expect(screen.getAllByText("Added")).toHaveLength(2)
    expect(screen.getAllByText("Removed")).toHaveLength(1)

    await user.click(within(saveBar()!).getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(screen.getByTestId("role-outcome")).toHaveTextContent("Saved 3 changes to Admissions Manager."))
    expect(actions.saveRole).toHaveBeenCalledTimes(1)
    expect(actions.saveRole).toHaveBeenCalledWith("r-man", {
      addPermissions: ["payments.record"],
      removePermissions: ["leads.view"],
      addManaged: ["r-acc"],
      removeManaged: [],
    })
    const outcome = screen.getByTestId("role-outcome")
    expect(outcome).toHaveTextContent("Can now: Record payments and maintain fees.")
    expect(outcome).toHaveTextContent("Can no longer: View applicants and their history.")
    expect(outcome).toHaveTextContent("Now manages the staff in: Accountant.")
    expect(saveBar()).toBeNull()
  })

  it("selecting a box back takes the change away, and Undo changes puts every box back", async () => {
    const user = userEvent.setup()
    renderPane()
    const payments = screen.getByRole("checkbox", { name: "Record payments and maintain fees" })
    await user.click(payments)
    await user.click(payments)
    expect(saveBar()).toBeNull()

    await user.click(payments)
    await user.click(screen.getByRole("checkbox", { name: "Admissions Staff" }))
    expect(within(saveBar()!).getByText("2 changes not saved")).toBeInTheDocument()
    await user.click(within(saveBar()!).getByRole("button", { name: "Undo changes" }))
    expect(saveBar()).toBeNull()
    expect(payments).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Admissions Staff" })).toBeChecked()
    expect(actions.saveRole).not.toHaveBeenCalled()
  })

  it("keeps every selection when the save is refused or the connection drops", async () => {
    const user = userEvent.setup()
    actions.saveRole.mockResolvedValueOnce({ ok: false, message: "The change could not be saved. Try again in a moment." })
    renderPane()
    await user.click(screen.getByRole("checkbox", { name: "Record payments and maintain fees" }))
    await user.click(within(saveBar()!).getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(screen.getByTestId("role-outcome")).toHaveTextContent("Nothing was saved."))
    expect(screen.getByTestId("role-outcome")).toHaveTextContent("Your 1 change is still shown below. Press Save changes to try again.")
    expect(screen.getByRole("checkbox", { name: "Record payments and maintain fees" })).toBeChecked()
    expect(within(saveBar()!).getByText("1 change not saved")).toBeInTheDocument()

    actions.saveRole.mockRejectedValueOnce(new Error("network"))
    await user.click(await within(saveBar()!).findByRole("button", { name: "Save changes" }))
    await waitFor(() =>
      expect(screen.getByTestId("role-outcome")).toHaveTextContent("The connection dropped before the changes reached the database."),
    )
    expect(saveBar()).not.toBeNull()
  })

  it("asks before leaving with unsaved changes: keep editing, or leave without saving", async () => {
    const user = userEvent.setup()
    renderPane(ROLE, PERMISSIONS, <Link href="/staff/home">Home</Link>)

    // Nothing changed: the link is left alone.
    const home = screen.getByRole("link", { name: "Home" })
    home.addEventListener("click", (event) => event.preventDefault())
    await user.click(home)
    expect(screen.queryByRole("dialog", { name: "Save your changes to Admissions Manager?" })).toBeNull()

    await user.click(screen.getByRole("checkbox", { name: "Record payments and maintain fees" }))
    await user.click(home)
    let sheet = await screen.findByRole("dialog", { name: "Save your changes to Admissions Manager?" })
    expect(sheet).toHaveAccessibleDescription(
      "You made 1 change and haven't saved it. If you leave without saving, it goes back to how it was.",
    )
    await user.click(within(sheet).getByRole("button", { name: "Keep editing" }))
    expect(screen.getByRole("checkbox", { name: "Record payments and maintain fees" })).toBeChecked()
    expect(push).not.toHaveBeenCalled()

    await user.click(home)
    sheet = await screen.findByRole("dialog", { name: "Save your changes to Admissions Manager?" })
    await user.click(within(sheet).getByRole("button", { name: "Leave without saving" }))
    expect(push).toHaveBeenCalledWith("/staff/home")
    expect(actions.saveRole).not.toHaveBeenCalled()
  })

  it("saves, then leaves, from the question", async () => {
    const user = userEvent.setup()
    actions.saveRole.mockResolvedValue({ ok: true, message: "Saved 1 change to Admissions Manager." })
    renderPane(ROLE, PERMISSIONS, <Link href="/staff/home">Home</Link>)
    await user.click(screen.getByRole("checkbox", { name: "Record payments and maintain fees" }))
    await user.click(screen.getByRole("link", { name: "Home" }))
    const sheet = await screen.findByRole("dialog", { name: "Save your changes to Admissions Manager?" })
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff/home"))
    expect(actions.saveRole).toHaveBeenCalledTimes(1)
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
  // A template comes from the "Start from" list, the kit Select, whose popup
  // jsdom cannot open; e2e/roles-v2.spec.ts creates a role from a template.
  it("adds a blank role with the typed name", async () => {
    const user = userEvent.setup()
    actions.addRole.mockResolvedValue({ ok: true, message: "Added.", roleId: "r-new" })
    render(<NewRoleForm />)

    await user.type(screen.getByLabelText("Role name"), "Gatekeepers")
    await user.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() => expect(actions.addRole).toHaveBeenCalledWith("Gatekeepers", null))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff/roles?role=r-new"))
  })
})

describe("Staff and roles controls that are closed", () => {
  it("closes Move to, Deactivate and Reactivate when the screen says why, and links the reason", () => {
    renderPane({
      ...ROLE,
      people: [
        person({ moveBlocked: "Only one Super Admin.", deactivateBlocked: "You can't deactivate yourself." }),
        person({ id: "p-3", name: "Chausiku Gone", active: false, status: "Deactivated", canSendReset: false, reactivateBlocked: "Their role is retired." }),
      ],
    })
    const asha = row("Asha Fixture")
    expect(within(asha).getByRole("button", { name: "Move to…" })).toBeDisabled()
    expect(within(asha).getByRole("button", { name: "Move to…" })).toHaveAccessibleDescription(/Only one Super Admin\./)
    expect(within(asha).getByRole("button", { name: "Deactivate" })).toBeDisabled()
    expect(within(asha).getByRole("button", { name: "Deactivate" })).toHaveAccessibleDescription(/You can't deactivate yourself\./)
    expect(within(row("Chausiku Gone")).getByRole("button", { name: "Reactivate" })).toBeDisabled()
  })

  it("closes Retire role while someone holds it, and says who", () => {
    renderPane({ ...ROLE, retireBlocked: "Admissions Manager is still held by Asha Fixture. Move them to another role first." })
    const retire = screen.getByRole("button", { name: "Retire role" })
    expect(retire).toBeDisabled()
    expect(retire).toHaveAccessibleDescription("Admissions Manager is still held by Asha Fixture. Move them to another role first.")
  })

  it("closes Rename and the permission tick boxes on a role that is not open to editing", () => {
    renderPane({ ...ROLE, editable: false })
    expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled()
    for (const box of screen.getAllByRole("checkbox", { name: /View applicants|Record payments/ })) expect(box).toHaveAttribute("aria-disabled", "true")
  })

  it("on a retired role, closes the managed set and offers Reactivate role, not Retire", () => {
    renderPane({ ...ROLE, retired: true, editable: false })
    expect(screen.queryByRole("button", { name: "Retire role" })).toBeNull()
    expect(screen.getByRole("button", { name: "Reactivate role" })).toBeEnabled()
    expect(screen.getByRole("checkbox", { name: "Accountant" })).toHaveAttribute("aria-disabled", "true")
  })

  it("lets a retired managed role be taken out of the set, but not put in", () => {
    renderPane({
      ...ROLE,
      managedOptions: [
        { id: "r-old", name: "Receptionist", checked: true, retired: true },
        { id: "r-gone", name: "Cashier", checked: false, retired: true },
      ],
    })
    expect(screen.getByRole("checkbox", { name: "Receptionist (retired)" })).not.toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("checkbox", { name: "Cashier (retired)" })).toHaveAttribute("aria-disabled", "true")
  })

  it("names the permission a paired one needs, and selects and clears them together", async () => {
    const user = userEvent.setup()
    renderPane({ ...ROLE, permissions: [] }, [...PERMISSIONS, { name: "reports.view", label: "View Reports" }])
    expect(screen.getByRole("checkbox", { name: "View Reports" })).toHaveAccessibleDescription(
      "Needs “View applicants and their history”. Selecting this selects it too; clearing that clears this.",
    )
    await user.click(screen.getByRole("checkbox", { name: "View Reports" }))
    expect(screen.getByRole("checkbox", { name: "View applicants and their history" })).toBeChecked()
    expect(within(saveBar()!).getByText("2 changes not saved")).toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: "View applicants and their history" }))
    expect(screen.getByRole("checkbox", { name: "View Reports" })).not.toBeChecked()
    expect(saveBar()).toBeNull()
  })
})
