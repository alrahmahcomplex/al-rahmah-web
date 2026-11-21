import type { Metadata } from "next"

import { ButtonLink, PageHeader, pageTitle } from "@/components/kit"
import { admissionYears } from "@/lib/admission-form"
import { tanzaniaToday } from "@/lib/school-calendar"
import { getFeeSchedule } from "@/lib/services/fees"
import { createClient } from "@/utils/supabase/server"

import StaffForbidden from "../../forbidden"
import { requireStaff } from "../../session"
import { comingIntake, type FeeTable } from "./model"
import { mayRegister } from "./permissions"
import { RegisterStudents } from "./register-students"
import "./register.css"

export const metadata: Metadata = {
  title: pageTitle("Register students"),
}

// Register students (#308) opens in place on Home: the sidebar keeps Home
// current, and "‹ Home" goes back.
export default async function RegisterStudentsPage() {
  const staff = await requireStaff()
  if (!mayRegister(staff.permissions)) return <StaffForbidden />

  const today = tanzaniaToday()
  const years = admissionYears()
  const supabase = await createClient()
  const fees: FeeTable = {}
  for (const year of years) {
    const schedule = await getFeeSchedule(supabase, year)
    if (schedule.ok) fees[year] = schedule.data.bands
  }

  return (
    <div className="rs-page">
      <ButtonLink href="/staff" variant="ghost" size="small" icon="back" className="rs-home">
        Home
      </ButtonLink>
      <PageHeader title="Register students" subtitle="For a family with no Admission Number. Start with the students, then their custodians." />
      <RegisterStudents
        staffId={staff.id}
        today={today}
        years={years}
        defaultYear={comingIntake(years, today)}
        fees={fees}
        canLink={staff.permissions.includes("leads.edit")}
        canEnterCode={staff.permissions.includes("leads.edit")}
        canCheck={staff.permissions.includes("leads.view")}
        canInterview={staff.permissions.includes("interviews.record")}
      />
    </div>
  )
}
