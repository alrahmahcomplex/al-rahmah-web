import { redirect } from "next/navigation"
import { cache } from "react"

import { getStaffUser, type StaffMember, type StaffUserError } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

// Where a session that cannot use the staff side is sent. The login page
// explains the ones a person can act on.
const SIGN_IN_FOR: Record<StaffUserError, string> = {
  "signed-out": "/login",
  "not-staff": "/login?error=not-staff",
  deactivated: "/login?error=deactivated",
  unavailable: "/login?error=unavailable",
}

// Read once per request, however many layouts and pages ask.
const currentStaff = cache(async () => getStaffUser(await createClient()))

// The signed-in staff member, or a redirect to sign-in. Layouts do not
// re-render when moving between pages, so every staff page calls this itself
// rather than relying on the layout's call.
export async function requireStaff(): Promise<StaffMember> {
  const staff = await currentStaff()
  if (!staff.ok) redirect(SIGN_IN_FOR[staff.error])
  return staff.data
}
