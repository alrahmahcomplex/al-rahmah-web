import type { SupabaseClient } from "@supabase/supabase-js"

import { readWithClockRetry } from "./clock-retry"
import type { Result } from "./result"

// The students using the signed-in agent's Discount code (#195), read through
// `agent_students`, the only way an agent session reads a lead. The database
// decides what an agent may see; this only renames it.

export type AgentStudentStatus = "Applied" | "Visited" | "Interviewed" | "Enrolled" | "Declined"

export type AgentStudent = {
  name: string
  className: string
  status: AgentStudentStatus
  // A closure mark is set (never which one or why).
  notActive: boolean
  // The Tanzanian date of the last change, YYYY-MM-DD.
  lastChange: string
  declinedReason: string | null
  interviewRegistered: boolean
  // The latest interview's result, once its fee is Paid.
  result: { outcome: "Passed" | "Failed"; score: number } | null
}

export type AgentStudents =
  | { kind: "active"; code: string; total: number; matched: number; students: AgentStudent[] }
  // Only the message shows: no code, no share buttons, no students.
  | { kind: "switched-off" | "retired" | "access-off" }

export type AgentStudentsError = "not-agent" | "unavailable"

export type AgentStudentsPage = { search: string; limit: number; offset: number }

type Row = {
  student_name: string
  class_name: string
  status: AgentStudentStatus
  not_active: boolean
  last_change: string
  declined_reason: string | null
  interview_registered: boolean
  interview_result: "Passed" | "Failed" | null
  interview_score: number | null
}

type Answer = { state: string; code?: string; total?: number; matched?: number; students?: Row[] } | null

const STATES: Record<string, "switched-off" | "retired" | "access-off"> = {
  switched_off: "switched-off",
  retired: "retired",
  access_off: "access-off",
  // A Pending agent never gets a login; if one did, it reads nothing.
  not_approved: "switched-off",
}

export async function getAgentStudents(
  supabase: SupabaseClient,
  page: AgentStudentsPage,
): Promise<Result<AgentStudents, AgentStudentsError>> {
  const { data, error } = await readWithClockRetry(() =>
    supabase.rpc("agent_students", { search: page.search.trim() || null, page_limit: page.limit, page_offset: page.offset }),
  )
  if (error) {
    console.error("Could not read the students using a Discount code", error)
    return { ok: false, error: "unavailable" }
  }
  const answer = data as Answer
  if (!answer) return { ok: false, error: "not-agent" }
  if (answer.state !== "active") {
    const kind = STATES[answer.state]
    if (!kind) {
      console.error("Unknown Discount code account state", answer.state)
      return { ok: false, error: "unavailable" }
    }
    return { ok: true, data: { kind } }
  }
  return {
    ok: true,
    data: {
      kind: "active",
      code: answer.code ?? "",
      total: answer.total ?? 0,
      matched: answer.matched ?? 0,
      students: (answer.students ?? []).map((row) => ({
        name: row.student_name,
        className: row.class_name,
        status: row.status,
        notActive: row.not_active,
        lastChange: row.last_change,
        declinedReason: row.declined_reason,
        interviewRegistered: row.interview_registered,
        result:
          row.interview_result && row.interview_score !== null
            ? { outcome: row.interview_result, score: Number(row.interview_score) }
            : null,
      })),
    },
  }
}
