import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { Dashboard } from "./_dashboard/dashboard"

export const metadata: Metadata = {
  title: "Reports · Al-Rahmah Complex",
}

// The statistics that were the staff home until #226, for staff who
// administer the staff side. The dashboard reads leads, so the page needs
// leads.view as well, as the sidebar entry does.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("staff.administer") || !staff.permissions.includes("leads.view")) forbidden()

  const supabase = await createClient()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Reports</h1>
      <Dashboard
        supabase={supabase}
        searchParams={await searchParams}
        canOpenSeats={staff.permissions.includes("academic_years.manage")}
      />
    </div>
  )
}
