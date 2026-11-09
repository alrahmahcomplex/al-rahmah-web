import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { enrollmentYears, tanzaniaToday } from "@/lib/school-calendar"

import { requireStaff } from "../../session"
import { NewStudentForm } from "./new-student-form"

export const metadata: Metadata = {
  title: "Register a student · Al-Rahmah Complex",
}

export default async function NewStudentPage() {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.create") || !staff.permissions.includes("visits.record")) forbidden()

  return (
    <NewStudentForm
      today={tanzaniaToday()}
      years={enrollmentYears()}
      canEditContact={staff.permissions.includes("leads.edit")}
      canEnterReferralCode={staff.permissions.includes("leads.edit")}
    />
  )
}
