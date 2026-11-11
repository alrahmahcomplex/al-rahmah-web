import Link from "next/link"

import { Button } from "@/components/ui/button"

import { NoticeByLook } from "./_new-shell/page-states"

const TITLE = "Not available to your role"
const TEXT = "Your role doesn't include this page. Ask an Admissions Manager if you need it."

// Shown inside the staff layout when someone's role does not include the
// permission a page needs, in the look of the shell around it.
export default function StaffForbidden() {
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
