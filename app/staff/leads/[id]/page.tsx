import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { getLead } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { LeadSummary } from "./lead-summary"

export const metadata: Metadata = {
  title: "Lead · Al-Rahmah Complex",
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const { id } = await params
  const lead = await getLead(await createClient(), id)
  if (!lead.ok && lead.error === "not-found") notFound()
  if (!lead.ok) {
    return (
      <Alert variant="destructive">
        <AlertDescription>This lead could not be loaded. Try again in a moment.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <LeadSummary lead={lead.data} />
      <div>
        <Link href="/staff/check-in" className={buttonVariants({ variant: "outline" })}>Back to Check-in</Link>
      </div>
    </div>
  )
}
