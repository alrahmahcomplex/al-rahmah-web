import type { Metadata } from "next"

import { PageHeader, pageTitle } from "@/components/kit"
import { createClient } from "@/utils/supabase/server"

import StaffForbidden from "../forbidden"
import { requireStaff } from "../session"
import { Dashboard } from "./_dashboard/dashboard"
import { SiblingFollowUp } from "./sibling-follow-up"

export const metadata: Metadata = {
  title: pageTitle("Reports"),
}

// The statistics that were the staff home until #226, for holders of
// reports.view (#241). The database still answers each count only under
// leads.view and Seats by class only under payments.view, so the page shows
// nobody more than their role reads elsewhere. Sibling discount follow-up
// (#311) shows each count to the role that may read it.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("reports.view")) return <StaffForbidden />

  const supabase = await createClient()

  return (
    <>
      <PageHeader title="Reports" />
      <Dashboard
        supabase={supabase}
        searchParams={await searchParams}
        // Everyone who may view payments opens Seats (#449), as the sidebar shows it.
        canOpenSeats={staff.permissions.includes("payments.view")}
      />
      <SiblingFollowUp supabase={supabase} permissions={staff.permissions} />
    </>
  )
}
