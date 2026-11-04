"use server"

import { revalidatePath } from "next/cache"
import { setGroupLink, type SetGroupLinkError } from "@/lib/services/group-links"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

export async function saveGroupLink(year: number, link: string, seen: string | null): Promise<{ ok: true } | { ok: false; error: SetGroupLinkError }> {
  if (!Number.isInteger(year)) return { ok: false, error: "invalid-year" }
  if (typeof link !== "string" || !(seen === null || typeof seen === "string")) return { ok: false, error: "invalid-link" }
  const client = await createClient()
  const allowed = await requirePermission(client, "group_links.manage")
  if (!allowed.ok) return { ok: false, error: "forbidden" }
  const result = await setGroupLink(client, year, link, seen)
  if (!result.ok) return result
  revalidatePath("/staff/group-links")
  return { ok: true }
}
