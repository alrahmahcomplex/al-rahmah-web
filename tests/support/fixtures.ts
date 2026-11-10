// The staff members created by supabase/seeds/00_base.sql. Local fixtures only.
const PASSWORD = "fixture-password"

function staff(id: string, name: string, email: string, roleName: string) {
  return { id, name, email, roleName, password: PASSWORD }
}

export type FixtureStaff = ReturnType<typeof staff>

export const MANAGER = staff("a1a1a1a1-0000-4000-8000-000000000001", "Test Manager", "manager@example.test", "Admissions Manager")
export const SECOND_MANAGER = staff(
  "a1a1a1a1-0000-4000-8000-000000000002",
  "Second Manager",
  "second-manager@example.test",
  "Admissions Manager",
)
export const ADMISSIONS = staff("a1a1a1a1-0000-4000-8000-000000000003", "Test Admissions", "admissions@example.test", "Admissions Staff")
export const ACCOUNTANT = staff("a1a1a1a1-0000-4000-8000-000000000004", "Test Accountant", "accountant@example.test", "Accountant")
// Deactivated, on a current role.
export const DEACTIVATED = staff(
  "a1a1a1a1-0000-4000-8000-000000000005",
  "Deactivated Staff",
  "deactivated@example.test",
  "Admissions Staff",
)
// Deactivated, on the retired Receptionist role.
export const RETIRED_ROLE = staff(
  "a1a1a1a1-0000-4000-8000-000000000006",
  "Retired Role Staff",
  "retired-role@example.test",
  "Receptionist",
)
// Invited, with no account yet: they have not opened their invite. No
// password works for them.
export const INVITED = staff("a1a1a1a1-0000-4000-8000-000000000007", "Invited Staff", "invited@example.test", "Admissions Staff")

// The Super Admin (#237): the staff record comes from
// supabase/migrations/20261130990300_super_admin_role.sql, its email from
// 20261204130900_super_admin_email.sql, the local login from
// supabase/seeds/00_base.sql. The role is hidden from every reader.
export const SUPER_ADMIN = {
  ...staff("5a000000-0000-4000-8000-000000000002", "Al-Rahmah Complex", "marketing.alrahmah@gmail.com", "Super Admin"),
  userId: "99999999-9999-4999-8999-999999999999",
  roleId: "5a000000-0000-4000-8000-000000000001",
}

// The Marketing Agent with a login, from the end of supabase/seeds/40_agents.sql:
// Approved, switched on, with a confirmed email and the shared fixture
// password. Seeding them turns agent access on. Local fixtures only.
export const SEEDED_AGENT = {
  id: "a4a4a4a4-0000-4000-8000-000000000003",
  userId: "77777777-7777-4777-8777-777777777777",
  name: "Saida Amina Mtei",
  code: "SAM-403",
  phone: "+255700000403",
  email: "agent@example.test",
  password: PASSWORD,
}
