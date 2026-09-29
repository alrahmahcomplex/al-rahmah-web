// The staff members created by supabase/seed.sql. Local fixtures only.
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
