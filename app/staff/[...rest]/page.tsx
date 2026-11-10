import { notFound } from "next/navigation"

import { requireStaff } from "../session"

// Any address under /staff that no page answers. Signed-in staff get the
// staff 404 inside the shell; everyone else is sent to sign in first, as on
// every other staff page.
export default async function UnknownStaffPage() {
  await requireStaff()
  notFound()
}
