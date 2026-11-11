import Link from "next/link"

import { Button } from "@/components/ui/button"

import { NoticeByLook } from "./_new-shell/page-states"

const TITLE = "This page does not exist"
const TEXT = "The link may be wrong or out of date. Check the address, or go back to the staff area."

// Shown inside the staff layout when a page or record is not there, such as a
// lead link with a wrong id, in the look of the shell around it. Built like
// the forbidden page beside it.
export default function StaffNotFound() {
  return (
    <NoticeByLook
      title={TITLE}
      text={TEXT}
      legacy={
        <div className="flex flex-col items-start gap-3">
          <h1 className="staff-heading">{TITLE}</h1>
          <p className="text-slate-700">{TEXT}</p>
          <Button variant="outline" render={<Link href="/staff" />} nativeButton={false}>
            Back to the staff area
          </Button>
        </div>
      }
    />
  )
}
