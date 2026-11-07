import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { Dashboard } from "./_dashboard/dashboard"

export const metadata: Metadata = {
  title: "Reports · Al-Rahmah Complex",
}

// The statistics that were the staff home until #226, for holders of
// reports.view (#241). The database still answers each count only under
// leads.view and Seats by class only under payments.view, so the page shows
// nobody more than their role reads elsewhere.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("reports.view")) forbidden()

  const supabase = await createClient()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="staff-heading">Reports</h1>
      <Dashboard
        supabase={supabase}
        searchParams={await searchParams}
        canOpenSeats={staff.permissions.includes("academic_years.manage")}
      />
    </div>
  )
}
