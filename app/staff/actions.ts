"use server"

import { redirect } from "next/navigation"

import { signOutStaff } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

export async function signOut() {
  const supabase = await createClient()
  await signOutStaff(supabase)
  redirect("/login")
}
