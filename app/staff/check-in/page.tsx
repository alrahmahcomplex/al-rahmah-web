import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { requireStaff } from "../session"
import { ArrivalSearch } from "./arrival-search"

export const metadata: Metadata = {
  title: "Check-in · Al-Rahmah Complex",
}

export default async function CheckInPage() {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  // Starting a registration needs both permissions, as the database does.
  const canRegister = staff.permissions.includes("leads.create") && staff.permissions.includes("visits.record")

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Who has arrived?</h1>
        <p className="max-w-prose text-sm text-slate-600">
          Ask the parent for the Admission Number, or search the student&apos;s name.
        </p>
      </div>
      <ArrivalSearch canRegister={canRegister} />
      {!canRegister && (
        <p className="text-sm text-muted-foreground">Your role can read leads but not register new students.</p>
      )}
    </div>
  )
}
