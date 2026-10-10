import type { Metadata } from "next"

import { getMyNotices } from "@/lib/services/staff-admin"
import { createClient } from "@/utils/supabase/server"

import { Dashboard } from "./_dashboard/dashboard"
import { Notices } from "./notices"
import { requireStaff } from "./session"

export const metadata: Metadata = {
  title: "Staff · Al-Rahmah Complex",
}

export default async function StaffHomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  const supabase = await createClient()
  const notices = await getMyNotices(supabase)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-blue-600 font-exo font-extrabold italic text-2xl">Staff area</h1>
        <p className="text-slate-700">Welcome, {staff.name}.</p>
      </div>
      {notices.ok ? (
        <Notices notices={notices.data} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Recent changes to your account could not be loaded. Try again in a moment.
        </p>
      )}
      {staff.permissions.includes("leads.view") && (
        <Dashboard
          supabase={supabase}
          searchParams={await searchParams}
          canOpenSeats={staff.permissions.includes("academic_years.manage")}
        />
      )}
    </div>
  )
}
