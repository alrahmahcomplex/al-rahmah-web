import { PageNotice } from "./_new-shell/page-states"

// Shown inside the staff layout when a page or record is not there, such as a
// lead link with a wrong id. Built like the forbidden page beside it. A staff
// page returns it rather than calling notFound(), which fails its streamed
// loading boundary (#437, #441).
export default function StaffNotFound() {
  return <PageNotice title="This page does not exist" text="The link may be wrong or out of date. Check the address, or go back to the staff area." />
}
