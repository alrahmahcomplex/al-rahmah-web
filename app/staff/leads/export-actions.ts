"use server"

import { enrollmentYears } from "@/lib/school-calendar"
import { countLeadsByYear } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

export type ExportCounts = { all: number; byYear: Record<number, number> } | null

// How many rows the export's "Which applicants" choices hold, read when the
// export sheet opens. Row-level security counts nothing without leads.view.
// Null when they can't be read: the sheet then shows the columns alone.
export async function exportCounts(): Promise<ExportCounts> {
  const supabase = await createClient()
  const counted = await countLeadsByYear(supabase, enrollmentYears())
  return counted.ok ? counted.data : null
}
