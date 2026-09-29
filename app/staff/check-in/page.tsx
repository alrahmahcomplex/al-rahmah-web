import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { buttonVariants } from "@/components/ui/button"

import { requireStaff } from "../session"

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
      <p className="max-w-prose text-slate-700">Receive a family who has come to campus.</p>
      {canRegister ? (
        <div>
          <Link href="/staff/check-in/new" className={buttonVariants({ size: "lg" })}>New Student</Link>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Your role can read leads but not register new students.</p>
      )}
    </div>
  )
}
