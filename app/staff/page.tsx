import type { Metadata } from "next"
import Image from "next/image"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { getStaffUser } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { signOut } from "./actions"

export const metadata: Metadata = {
  title: "Staff · Al-Rahmah Complex",
}

export default async function StaffHomePage() {
  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok) {
    redirect(staff.error === "not-on-allowlist" ? "/login?error=not-on-allowlist" : "/login")
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-br from-blue-100 via-blue-100/50 to-white p-8">
      <Image src="/Al-Rahmah_Official_Logo.svg" alt="Al-Rahmah Logo" width={96} height={96} />
      <h1 className="text-blue-600 font-exo font-extrabold italic text-2xl">Staff area</h1>
      <p className="text-slate-700">
        Signed in as <span className="font-semibold">{staff.data.email}</span>
      </p>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  )
}
