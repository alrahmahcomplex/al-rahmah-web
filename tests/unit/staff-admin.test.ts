import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import {
  assignRole,
  correctStaffName,
  createRole,
  createRoleFromTemplate,
  reactivateRole,
  deactivateStaff,
  describeAuditRow,
  reactivateStaff,
  renameRole,
  retireRole,
  setRoleManages,
  setRolePermission,
  type AuditRow,
  type HistoryLookup,
} from "@/lib/services/staff-admin"

// A stand-in for the Supabase SDK: `rpc` answers with the given error, the
// way PostgREST reports a `raise exception` (message and details).
function fakeSupabase(error: { message: string; details?: string | null; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: error ? null : { name: "Baraka Said", role: "Accountant" }, error })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

function refusedWith(message: string, details: Record<string, unknown> | null = null) {
  return fakeSupabase({ message, details: details && JSON.stringify(details), code: "P0001" }).client
}

describe("the staff-admin writes", () => {
  it("call the guardrailed database function for each change", async () => {
    const { client, rpc } = fakeSupabase()

    expect(await assignRole(client, "staff-1", "role-1")).toEqual({
      ok: true,
      data: { name: "Baraka Said", role: "Accountant" },
    })
    await deactivateStaff(client, "staff-1")
    await reactivateStaff(client, "staff-1")
    await correctStaffName(client, "staff-1", "Zawadi Mrisho")

    expect(rpc.mock.calls).toEqual([
      ["assign_staff_role", { staff_id: "staff-1", role_id: "role-1" }],
      ["deactivate_staff_member", { staff_id: "staff-1" }],
      ["reactivate_staff_member", { staff_id: "staff-1" }],
      ["correct_staff_name", { staff_id: "staff-1", full_name: "Zawadi Mrisho" }],
    ])
  })

  it("call the guardrailed database function for each role change", async () => {
    const { client, rpc } = fakeSupabase()

    await createRole(client, "Receptionist")
    await createRole(client, "Head Accountant", { permissions: ["leads.view"], manages: ["role-2"], managedBy: ["role-3"] })
    await renameRole(client, "role-1", "Front desk")
    await setRolePermission(client, "role-1", "leads.view", true)
    await retireRole(client, "role-1")
    await reactivateRole(client, "role-1")
    await setRoleManages(client, "role-1", "role-2", false)

    expect(rpc.mock.calls).toEqual([
      ["create_role", { name: "Receptionist", permissions: [], manages: [], managed_by: [] }],
      ["create_role", { name: "Head Accountant", permissions: ["leads.view"], manages: ["role-2"], managed_by: ["role-3"] }],
      ["rename_role", { role_id: "role-1", name: "Front desk" }],
      ["set_role_permission", { role_id: "role-1", permission: "leads.view", granted: true }],
      ["retire_role", { role_id: "role-1" }],
      ["reactivate_role", { role_id: "role-1" }],
      ["set_role_manages", { role_id: "role-1", managed_role_id: "role-2", manages: false }],
    ])
  })
})

describe("createRoleFromTemplate", () => {
  function fakeWithRoles(roles: { id: string; name: string; retired: boolean }[], readError: { message: string } | null = null) {
    const rpc = vi.fn().mockResolvedValue({ data: { id: "new-role", role: "Made" }, error: null })
    const select = vi.fn().mockResolvedValue({ data: readError ? null : roles, error: readError })
    const from = vi.fn(() => ({ select }))
    return { client: { rpc, from } as unknown as SupabaseClient, rpc, from }
  }

  it("creates a blank role without reading the roles", async () => {
    const { client, rpc, from } = fakeWithRoles([])
    await createRoleFromTemplate(client, "Front desk", null)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith("create_role", { name: "Front desk", permissions: [], manages: [], managed_by: [] })
  })

  it("brings a template's permissions and links the current roles by name, both ways", async () => {
    const { client, rpc } = fakeWithRoles([
      { id: "staff", name: "Admissions Staff", retired: false },
      { id: "admin", name: "Administrator", retired: false },
      { id: "old", name: "Accountant", retired: true },
    ])
    expect(await createRoleFromTemplate(client, "Front office lead", "Admissions Manager")).toEqual({
      ok: true,
      data: { id: "new-role", role: "Made" },
    })
    expect(rpc).toHaveBeenCalledWith("create_role", {
      name: "Front office lead",
      permissions: expect.arrayContaining(["agents.approve", "leads.view"]),
      manages: ["staff"],
      managed_by: ["admin"],
    })
  })

  it("refuses an unknown template and fails closed when the roles can't be read, creating nothing", async () => {
    const unknown = fakeWithRoles([])
    expect(await createRoleFromTemplate(unknown.client, "X", "Chief Everything")).toMatchObject({ ok: false, error: { code: "unknown_template" } })
    const down = fakeWithRoles([], { message: "fetch failed" })
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await createRoleFromTemplate(down.client, "X", "Accountant")).toMatchObject({ ok: false, error: { code: "unavailable" } })
    expect(unknown.rpc).not.toHaveBeenCalled()
    expect(down.rpc).not.toHaveBeenCalled()
  })
})

describe("refusal messages", () => {
  const cases: [string, Record<string, unknown> | null, string][] = [
    ["not_permitted", { role: "Accountant" }, "Your role, Accountant, doesn't manage any staff."],
    ["not_permitted", null, "Your role doesn't manage any staff."],
    [
      "forbidden",
      null,
      "Your role can't make that change. Only the Super Admin changes roles, and you manage only the staff in the roles your role manages.",
    ],
    [
      "own_role",
      null,
      "You can't change your own role. The Super Admin, or someone whose role manages yours, has to do it.",
    ],
    ["own_account", null, "You can't deactivate yourself."],
    ["role_retired", { role: "Receptionist" }, '"Receptionist" is retired, so nobody can be given it.'],
    [
      "retired_role_on_reactivate",
      { name: "Salma Kombo", role: "Receptionist" },
      'Salma Kombo\'s role "Receptionist" was retired. Give them a current role first, then reactivate.',
    ],
    ["same_role", { name: "Baraka Said", role: "Accountant" }, "Baraka Said already holds Accountant."],
    ["already_active", { name: "Baraka Said" }, "Baraka Said is already active."],
    ["already_deactivated", { name: "Baraka Said" }, "Baraka Said is already deactivated."],
    ["name_required", null, "Enter the person's full name."],
    ["not_found", null, "That staff member or role no longer exists. Reload the page and try again."],
    ["role_not_retired", { role: "Accountant" }, "Accountant is already a current role."],
    ["manages_itself", { role: "Accountant" }, "Accountant can't manage its own staff: its holders would manage each other."],
    [
      "role_has_active_holders",
      { role: "Receptionist", names: ["Neema Mushi"] },
      "Receptionist is still held by Neema Mushi. Move them to another role first.",
    ],
    [
      "role_has_active_holders",
      { role: "Receptionist", names: ["Baraka Said", "Neema Mushi", "Salma Kombo"] },
      "Receptionist is still held by Baraka Said, Neema Mushi and Salma Kombo. Move them to another role first.",
    ],
    ["duplicate_role_name", { role: "Accountant" }, 'A role called "Accountant" already exists.'],
    ["role_name_required", null, "Enter a name for the role."],
    ["unknown_permission", null, "That permission no longer exists. Reload the page and try again."],
  ]

  for (const [code, details, message] of cases) {
    it(`turns ${code}${details ? " with names" : ""} into its sentence`, async () => {
      expect(await deactivateStaff(refusedWith(code, details), "staff-1")).toEqual({
        ok: false,
        error: { code, message },
      })
    })
  }

  it("reports an unknown database error as unavailable, never showing it raw", async () => {
    const client = fakeSupabase({ message: "connection terminated unexpectedly" }).client

    expect(await assignRole(client, "staff-1", "role-1")).toEqual({
      ok: false,
      error: { code: "unavailable", message: "The change could not be saved. Try again in a moment." },
    })
  })

  it("still gives the sentence when the names cannot be read", async () => {
    const client = fakeSupabase({ message: "own_account", details: "not json" }).client

    expect(await deactivateStaff(client, "staff-1")).toEqual({
      ok: false,
      error: { code: "own_account", message: "You can't deactivate yourself." },
    })
  })
})

describe("describeAuditRow", () => {
  const lookup: HistoryLookup = {
    staffNames: new Map([
      ["manager", "Amina Juma"],
      ["baraka", "Baraka Said"],
    ]),
    roleNames: new Map([
      ["role-admissions", "Admissions Staff"],
      ["role-accountant", "Accountant"],
    ]),
    permissionLabels: new Map([["leads.view", "View leads and their history"]]),
  }

  function row(overrides: Partial<AuditRow>): AuditRow {
    return {
      id: 1,
      table_name: "staff_members",
      row_id: "baraka",
      action: "update",
      old_values: null,
      new_values: null,
      actor_kind: "staff",
      actor_staff_id: "manager",
      created_at: "2026-09-29T10:00:00Z",
      ...overrides,
    }
  }

  it("summarises a managed-set pair and the seeded roles becoming templates (#241)", () => {
    const pair = (overrides: Partial<AuditRow>) => describeAuditRow(row({ table_name: "role_managed_roles", row_id: "pair-1", ...overrides }), lookup)

    expect(pair({ action: "insert", new_values: { role_id: "role-accountant", managed_role_id: "role-admissions", active: true } })).toMatchObject({
      summary: "let Accountant manage the staff in Admissions Staff",
      changes: [],
    })
    // An update carries only the switch; the pair, found by its row id, names both roles.
    const withPairs: HistoryLookup = {
      ...lookup,
      managedPairs: new Map([["pair-1", { roleId: "role-accountant", managedRoleId: "role-admissions" }]]),
    }
    const switched = (active: boolean) =>
      describeAuditRow(
        row({ table_name: "role_managed_roles", row_id: "pair-1", old_values: { active: !active }, new_values: { active } }),
        withPairs,
      ).summary
    expect(switched(false)).toBe("stopped Accountant managing the staff in Admissions Staff")
    expect(switched(true)).toBe("let Accountant manage the staff in Admissions Staff again")
    // A pair the reader can't resolve still reads as a sentence.
    expect(pair({ old_values: { active: true }, new_values: { active: false } }).summary).toBe("stopped a role managing the staff in a role")
    expect(
      describeAuditRow(row({ table_name: null, row_id: null, action: "roles_became_templates", actor_kind: "system", actor_staff_id: null, new_values: { removed: ["Accountant"] } }), lookup)
        .summary,
    ).toBe("turned the seeded roles into templates")
  })

  it("names the actor and shows a role change by role name", () => {
    expect(
      describeAuditRow(
        row({ old_values: { role_id: "role-admissions" }, new_values: { role_id: "role-accountant" } }),
        lookup,
      ),
    ).toEqual({
      id: 1,
      at: "2026-09-29T10:00:00Z",
      actor: "Amina Juma",
      summary: "changed Baraka Said",
      changes: [{ field: "role", from: "Admissions Staff", to: "Accountant" }],
    })
  })

  it("shows deactivation and name corrections in plain words", () => {
    expect(
      describeAuditRow(
        row({ old_values: { active: true, full_name: "Barak Said" }, new_values: { active: false, full_name: "Baraka Said" } }),
        lookup,
      ).changes,
    ).toEqual([
      { field: "status", from: "Active", to: "Deactivated" },
      { field: "name", from: "Barak Said", to: "Baraka Said" },
    ])
  })

  it("shows a dismissal of sign-in notices as a date in East Africa Time", () => {
    expect(
      describeAuditRow(
        row({
          actor_staff_id: "baraka",
          old_values: { notices_seen_at: "2026-09-24T09:00:00+00:00" },
          new_values: { notices_seen_at: "2026-09-29T10:00:00.123456+00:00" },
        }),
        lookup,
      ).changes,
    ).toEqual([{ field: "notices read", from: "24 Sept 2026, 12:00", to: "29 Sept 2026, 13:00" }])
  })

  it("shows keys it does not know raw instead of dropping them", () => {
    expect(
      describeAuditRow(row({ old_values: { shift: "morning" }, new_values: { shift: { days: 5 } } }), lookup).changes,
    ).toEqual([{ field: "shift", from: "morning", to: '{"days":5}' }])
  })

  it("names system writes and staff who are no longer on the list", () => {
    expect(describeAuditRow(row({ actor_kind: "system", actor_staff_id: null }), lookup).actor).toBe("System")
    expect(describeAuditRow(row({ actor_staff_id: "gone" }), lookup).actor).toBe("A former staff member")
  })

  it("summarises the hosted reset record in words and keeps its counts out of the change list", () => {
    const entry = describeAuditRow(
      row({
        table_name: null,
        row_id: null,
        action: "hosted_reset",
        actor_kind: "system",
        actor_staff_id: null,
        new_values: { ticket: "#197", cutoff: "2026-11-20T18:00:00+00:00", cleared: { leads: 79, staff_members: 9 }, auth_users: 9 },
      }),
      lookup,
    )
    expect(entry).toMatchObject({ actor: "System", summary: "reset the database before launch", changes: [] })
  })

  it("summarises a new staff member without bookkeeping columns", () => {
    const entry = describeAuditRow(
      row({
        action: "insert",
        new_values: { id: "baraka", full_name: "Baraka Said", role_id: "role-admissions", created_at: "x" },
      }),
      lookup,
    )

    expect(entry.summary).toBe("added Baraka Said to staff")
    expect(entry.changes).toEqual([
      { field: "name", from: null, to: "Baraka Said" },
      { field: "role", from: null, to: "Admissions Staff" },
    ])
  })

  it("describes role changes and invites", () => {
    expect(
      describeAuditRow(
        row({
          table_name: "roles",
          row_id: "role-accountant",
          old_values: { permissions: [] },
          new_values: { permissions: ["leads.view"] },
        }),
        lookup,
      ),
    ).toMatchObject({
      summary: "changed the role Accountant",
      changes: [{ field: "permissions", from: "None", to: "View leads and their history" }],
    })
    expect(
      describeAuditRow(row({ table_name: null, row_id: null, action: "invite_sent", new_values: { email: "x@example.test" } }), lookup),
    ).toMatchObject({ summary: "sent an invite", changes: [{ field: "email", from: null, to: "x@example.test" }] })
  })

  it("names who an invite went to", () => {
    expect(
      describeAuditRow(
        row({
          table_name: null,
          row_id: null,
          action: "invite_sent",
          new_values: { staff_member_id: "baraka", email: "baraka@example.test" },
        }),
        lookup,
      ),
    ).toMatchObject({
      summary: "sent an invite to Baraka Said",
      changes: [{ field: "email", from: null, to: "baraka@example.test" }],
    })
  })

  it("names who a Manager sent a password reset link to (#265)", () => {
    expect(
      describeAuditRow(
        row({
          table_name: null,
          row_id: null,
          action: "password_reset_sent",
          new_values: { staff_member_id: "baraka", email: "baraka@example.test" },
        }),
        lookup,
      ),
    ).toMatchObject({
      summary: "asked for a password reset link for Baraka Said",
      changes: [{ field: "email", from: null, to: "baraka@example.test" }],
    })
  })
})
