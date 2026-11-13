import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { Note, PageHeader, pageTitle } from "@/components/kit"
import { tanzaniaToday } from "@/lib/school-calendar"
import { getHighestAgentDiscount } from "@/lib/services/discount-codes"
import { listPromoCodes } from "@/lib/services/promo-codes"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { PromoCodes } from "./promo-codes"
import "../agents/agents.css"

export const metadata: Metadata = {
  title: pageTitle("Promo codes"),
}

// Promo codes: school codes for campaigns and groups, with a name and an
// amount off the interview fee, never an agent and never commission. Every
// staff member who reads applicants sees them; discount_codes.manage
// creates and changes them.
export default async function PromoCodesPage() {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()
  const canManage = staff.permissions.includes("discount_codes.manage")

  const supabase = await createClient()
  const [codes, highest] = await Promise.all([
    listPromoCodes(supabase),
    canManage ? getHighestAgentDiscount(supabase) : null,
  ])

  if (!codes.ok) {
    return (
      <div className="ag-page">
        <PageHeader title="Promo codes" subtitle="Codes for campaigns and groups. No agent, no commission, no login." />
        <Note tone="bad" role="alert">
          Promo codes could not be loaded. Try again in a moment.
        </Note>
      </div>
    )
  }

  return (
    <PromoCodes
      codes={codes.data}
      highestAgentAmount={highest?.ok ? highest.data : null}
      canManage={canManage}
      today={tanzaniaToday()}
    />
  )
}
