import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The WhatsApp group link for each Enrollment year (#183). Staff with
// group_links.manage save or replace a year's link; staff who view leads read
// them. The group invitation (#186) sends the year's link to families.

export type GroupLink = {
  year: number
  url: string
  setByName: string
  // ISO timestamp.
  setAt: string
}

export type ListGroupLinksError =
  // Signed out, or without leads.view.
  | "forbidden"
  | "unavailable"

export type SetGroupLinkError =
  // Signed out, or without group_links.manage.
  | "forbidden"
  // Not an https://chat.whatsapp.com/ invite link.
  | "invalid-link"
  | "invalid-year"
  // Someone else saved a link for the year since the caller read it.
  | "stale"
  | "unavailable"

type GroupLinkRow = { enrollment_year: number; url: string; set_by_name: string; set_at: string }

// Every year's saved link, oldest year first, with who set it and when.
export async function listGroupLinks(supabase: SupabaseClient): Promise<Result<GroupLink[], ListGroupLinksError>> {
  const { data, error } = await supabase.rpc("group_links")
  if (error) {
    // 42501: the function isn't granted to the caller, as for someone signed out.
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not read the WhatsApp group links", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: ((data ?? []) as GroupLinkRow[]).map((row) => ({
      year: row.enrollment_year,
      url: row.url,
      setByName: row.set_by_name,
      setAt: row.set_at,
    })),
  }
}

// Saves or replaces the link for `year`. `seen` is the link the caller saw
// for the year, null for none, so a stale form never undoes a newer change.
// Only https://chat.whatsapp.com/ invite links are accepted; the database
// checks that and the permission.
export async function setGroupLink(
  supabase: SupabaseClient,
  year: number,
  link: string,
  seen: string | null,
): Promise<Result<null, SetGroupLinkError>> {
  const { error } = await supabase.rpc("set_group_link", { link_year: year, link, link_was: seen })
  if (!error) return { ok: true, data: null }

  if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
  if (error.message === "stale") return { ok: false, error: "stale" }
  if (error.message === "invalid") {
    return { ok: false, error: invalidField(error.details) === "year" ? "invalid-year" : "invalid-link" }
  }
  console.error("Could not save the WhatsApp group link", error)
  return { ok: false, error: "unavailable" }
}

function invalidField(details: string | null | undefined): string | null {
  try {
    const parsed: unknown = JSON.parse(details ?? "")
    return typeof parsed === "object" && parsed !== null && "field" in parsed ? String(parsed.field) : null
  } catch {
    return null
  }
}
