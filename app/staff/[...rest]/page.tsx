import StaffNotFound from "../not-found"
import { requireStaff } from "../session"

// Any address under /staff that no page answers. Signed-in staff get the
// staff 404 inside the shell; everyone else is sent to sign in first, as on
// every other staff page.
//
// The page draws the 404 itself rather than calling notFound() (#437). It
// renders inside the Suspense boundary of the loading.tsx beside it, which
// has already streamed by then, so a notFound() here failed that boundary
// on the server. React then drew the 404 in the browser and reported error
// #419 once the person moved on to another page.
export default async function UnknownStaffPage() {
  await requireStaff()
  return <StaffNotFound />
}
