"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { signOutStaff } from "@/lib/services/staff-auth"
import { dismissNotices } from "@/lib/services/staff-admin"
import { createClient } from "@/utils/supabase/server"

export async function signOut() {
  const supabase = await createClient()
  await signOutStaff(supabase)
  redirect("/login")
}

export async function dismissMyNotices(through: number): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const result = await dismissNotices(supabase, through)
  revalidatePath("/staff")
  return { ok: result.ok }
}
