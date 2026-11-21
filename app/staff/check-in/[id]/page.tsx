import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { ButtonLink, Note, PageHeader, pageTitle } from "@/components/kit"
import { admissionYears } from "@/lib/admission-form"
import { tanzaniaToday } from "@/lib/school-calendar"
import { getAdmissionFormFamily, waitingChildren } from "@/lib/services/admission-form-family"
import { getFeeSchedule } from "@/lib/services/fees"
import { createClient } from "@/utils/supabase/server"

import { longDate } from "../../_home/activity"
import StaffForbidden from "../../forbidden"
import StaffNotFound from "../../not-found"
import { requireStaff } from "../../session"
import { comingIntake, type FeeTable } from "../new/model"
import { RegisterStudents } from "../new/register-students"
import "../new/register.css"
import { mayCheckIn } from "../permissions"
import { familyName, startCheckIn } from "./model"

export const metadata: Metadata = {
  title: pageTitle("Check in a family"),
}

// Check-in of an Admission form family (#309, prototype v38): opens in place
// on Home, with "‹ Home" to go back. A lead that is not an Admission form
// child still waiting for its visit opens its record instead.
export default async function CheckInFamilyPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff()
  if (!mayCheckIn(staff.permissions)) return <StaffForbidden />

  const { id } = await params
  const supabase = await createClient()
  const family = await getAdmissionFormFamily(supabase, id)
  if (!family.ok && family.error === "not-found") return <StaffNotFound />
  if (!family.ok && family.error === "not-admission-form") redirect(`/staff/applicants/${id}`)
  if (!family.ok) {
    return (
      <Note tone="bad" role="alert">
        This application could not be loaded. Try again in a moment.
      </Note>
    )
  }

  const children = waitingChildren(family.data)
  const looked = children.find((c) => c.leadId === id)
  if (!looked) redirect(`/staff/applicants/${id}`)

  const today = tanzaniaToday()
  const years = admissionYears()
  const fees: FeeTable = {}
  for (const year of new Set([...years, ...children.map((c) => c.enrollmentYear)])) {
    const schedule = await getFeeSchedule(supabase, year)
    if (schedule.ok) fees[year] = schedule.data.bands
  }

  const { answers, checkIn } = startCheckIn(family.data, children)
  const surname = familyName(children)
  const title = surname ? `Check in the ${surname} family` : "Check in the family"

  return (
    <div className="rs-page">
      <ButtonLink href="/staff" variant="ghost" size="small" icon="back" className="rs-home">
        Home
      </ButtonLink>
      {family.data.contact?.familyMatch ? (
        <>
          <PageHeader title={title} />
          <Note tone="wait" icon="alert" role="alert">
            The parent’s phone number waits for a Family match. Settle it on the student’s record in Applicants first, then check the family in.
          </Note>
        </>
      ) : (
        <RegisterStudents
          staffId={staff.id}
          today={today}
          years={years}
          defaultYear={comingIntake(years, today)}
          fees={fees}
          canLink
          canEnterCode={false}
          canCheck
          canInterview={staff.permissions.includes("interviews.record")}
          checkIn={{
            family: children.map((c) => c.leadId).join(","),
            given: checkIn,
            start: answers,
            title,
            subtitle: `Admission Number ${looked.admissionNumber}, sent from the Admission form on ${longDate(family.data.sentOn)}. Its answers are already filled in.`,
          }}
        />
      )}
    </div>
  )
}
