import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { enrollmentYears, tanzaniaToday } from "@/lib/school-calendar"

import { requireStaff } from "../../session"
import { NewStudentForm } from "./new-student-form"

export const metadata: Metadata = {
  title: "New Student · Al-Rahmah Complex",
}

export default async function NewStudentPage() {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.create") || !staff.permissions.includes("visits.record")) forbidden()

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">New Student</h1>
      <NewStudentForm
        today={tanzaniaToday()}
        years={enrollmentYears()}
        canEditContact={staff.permissions.includes("leads.edit")}
        canEnterReferralCode={staff.permissions.includes("leads.edit")}
      />
    </div>
  )
}
