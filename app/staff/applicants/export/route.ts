import type { NextRequest } from "next/server"

import { exportFileName, exportStudents, holdsTier, studentsCsv, tierNeeded } from "@/lib/services/student-export"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { EXPORT_REFUSALS, parseExportRequest, refusalOf } from "./parse"

// The applicant export's download: the export sheet's GET form lands here.
// export_leads decides the columns' tiers again, caps the rows and records the
// export in the audit history; this answers its rows as a CSV file, never
// cached. A refusal is a short plain-text page with its status.
export const dynamic = "force-dynamic"

function plain(status: number, text: string) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } })
}

export async function GET(request: NextRequest) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) return plain(403, EXPORT_REFUSALS.forbidden)

  const parsed = parseExportRequest(request.nextUrl.searchParams)
  if (!parsed) return plain(400, EXPORT_REFUSALS.invalid)
  // Refused before the database is asked; the database refuses it too.
  if (!holdsTier(tierNeeded(parsed.columns), { permissions: staff.permissions, superAdmin: staff.superAdmin })) {
    return plain(403, EXPORT_REFUSALS.forbidden)
  }

  const result = await exportStudents(await createClient(), parsed.filters, parsed.columns)
  if (!result.ok) {
    const refusal = refusalOf(result.error)
    return plain(refusal.status, refusal.text)
  }

  // The byte-order mark lets Excel read the names' accents.
  return new Response(`﻿${studentsCsv(result.data)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(parsed.preset)}"`,
      "Cache-Control": "no-store",
      "X-Row-Count": String(result.data.rowCount),
    },
  })
}
