import { PageNotice } from "./_new-shell/page-states"

// Shown inside the staff layout when someone's role does not include the
// permission a page needs. A staff page returns it rather than calling
// forbidden(), which fails its streamed loading boundary (#441).
export default function StaffForbidden() {
  return <PageNotice title="Not available to your role" text="Your role doesn't include this page. Ask an Admissions Manager if you need it." />
}
