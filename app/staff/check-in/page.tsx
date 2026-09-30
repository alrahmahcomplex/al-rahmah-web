import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { requireStaff } from "../session"
import { AdmissionNumberLookup } from "./admission-number-lookup"

export const metadata: Metadata = {
  title: "Check-in · Al-Rahmah Complex",
}

export default async function CheckInPage() {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  // Starting a registration needs both permissions, as the database does.
  const canRegister = staff.permissions.includes("leads.create") && staff.permissions.includes("visits.record")

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Check-in</h1>
      <p className="max-w-prose text-slate-700">
        Receive a family who has come to campus. Ask for their Admission Number first.
      </p>
      <AdmissionNumberLookup canRegister={canRegister} />
      {!canRegister && (
        <p className="text-sm text-muted-foreground">Your role can read leads but not register new students.</p>
      )}
    </div>
  )
}
