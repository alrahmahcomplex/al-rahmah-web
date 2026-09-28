import type { Metadata } from "next"

import { requireStaff } from "./session"

export const metadata: Metadata = {
  title: "Staff · Al-Rahmah Complex",
}

export default async function StaffHomePage() {
  const staff = await requireStaff()

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-blue-600 font-exo font-extrabold italic text-2xl">Staff area</h1>
      <p className="text-slate-700">Welcome, {staff.name}.</p>
    </div>
  )
}
