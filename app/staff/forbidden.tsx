import Link from "next/link"

import { Button } from "@/components/ui/button"

// Shown inside the staff layout when someone's role does not include the
// permission a page needs.
export default function StaffForbidden() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Not available to your role</h1>
      <p className="text-slate-700">
        Your role doesn&apos;t include this page. Ask an Admissions Manager if you need it.
      </p>
      <Button variant="outline" render={<Link href="/staff" />} nativeButton={false}>
        Back to the staff area
      </Button>
    </div>
  )
}
