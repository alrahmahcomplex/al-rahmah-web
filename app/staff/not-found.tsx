import Link from "next/link"

import { Button } from "@/components/ui/button"

// Shown inside the staff layout when a page or record is not there, such as a
// lead link with a wrong id. Built like the forbidden page beside it.
export default function StaffNotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="staff-heading">This page does not exist</h1>
      <p className="text-slate-700">The link may be wrong or out of date. Check the address, or go back to the staff area.</p>
      <Button variant="outline" render={<Link href="/staff" />} nativeButton={false}>
        Back to the staff area
      </Button>
    </div>
  )
}
