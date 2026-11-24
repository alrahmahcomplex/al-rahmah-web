import type { SupabaseClient } from "@supabase/supabase-js"

import { readWithClockRetry } from "./clock-retry"
import type { Result } from "./result"

// The students using the signed-in agent's Discount code (#195), read through
// `agent_students`, the only way an agent session reads a lead, with the
// dashboard's step counts and reminders (#497). The database decides what an
// agent may see and who could use a reminder; this only renames it.

export type AgentStudentStatus = "Applied" | "Visited" | "Interviewed" | "Enrolled" | "Declined"

export type AgentStudent = {
  // Opaque UUID for /students/[id].
  id: string
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

// The steps a reminder can be for.
export type ReminderStep = "Applied" | "Visited" | "Interviewed"

// A student waiting long enough at their step: whole days since it.
export type AgentReminder = { id: string; name: string; className: string; step: ReminderStep; days: number }

// A student whose record changed in the last 7 Tanzanian days (for the bell).
export type AgentRecentChange = { id: string; name: string; status: AgentStudentStatus; days: number }

export type AgentStudentDetail = AgentStudent & {
  reminder: { step: ReminderStep; days: number } | null
}

export type AgentStudents =
  | {
      kind: "active"
      code: string
      phone: string | null
      total: number
      matched: number
      students: AgentStudent[]
      // Every student carrying the code, by status, whatever the search.
      steps: Record<AgentStudentStatus, number>
      reminders: AgentReminder[]
      recent: AgentRecentChange[]
      // What the code takes off the interview fee now, in whole TZS: the
      // figure a family sees for it. 0 names no figure.
      discount: number
    }
  // Only the message shows: no code, no share buttons, no students.
  | { kind: "switched-off" | "retired" | "access-off" | "pending" }

export type AgentStudentResult =
  | { kind: "active"; student: AgentStudentDetail | null }
  | { kind: "switched-off" | "retired" | "access-off" | "pending" }

export type AgentStudentsError = "not-agent" | "unavailable"

// `step` lists only the students at that status.
export type AgentStudentsPage = { search: string; limit: number; offset: number; step?: AgentStudentStatus | null }

type Row = {
  id: string
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

type DetailRow = Row & {
  reminder_step: ReminderStep | null
  reminder_days: number | null
}

type ReminderRow = { id: string; student_name: string; class_name: string; step: ReminderStep; days: number }
type RecentRow = { id: string; student_name: string; status: AgentStudentStatus; days: number }

type Answer = {
  state: string
  code?: string
  phone?: string | null
  total?: number
  matched?: number
  students?: Row[]
  steps?: Record<AgentStudentStatus, number>
  reminders?: ReminderRow[]
  recent?: RecentRow[]
  discount?: number | null
} | null

type DetailAnswer = {
  state: string
  student?: DetailRow | null
} | null

const NO_STEPS: Record<AgentStudentStatus, number> = { Applied: 0, Visited: 0, Interviewed: 0, Enrolled: 0, Declined: 0 }

const STATES: Record<string, "switched-off" | "retired" | "access-off" | "pending"> = {
  switched_off: "switched-off",
  retired: "retired",
  access_off: "access-off",
  // A new agent's mobile login while the code waits (#503 slice 4d-b): it reads nothing.
  not_approved: "pending",
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function mapStudent(row: Row): AgentStudent {
  return {
    id: row.id,
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
  }
}

export async function getAgentStudents(
  supabase: SupabaseClient,
  page: AgentStudentsPage,
): Promise<Result<AgentStudents, AgentStudentsError>> {
  const { data, error } = await readWithClockRetry(() =>
    supabase.rpc("agent_students", {
      search: page.search.trim() || null,
      page_limit: page.limit,
      page_offset: page.offset,
      // Sent only when asked for: PostgREST picks a function by its argument
      // names, so the list still reads through the older three-argument
      // function if this app is live before its migration (#497).
      ...(page.step ? { step: page.step } : {}),
    }),
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
      phone: answer.phone ?? null,
      total: answer.total ?? 0,
      matched: answer.matched ?? 0,
      students: (answer.students ?? []).map(mapStudent),
      steps: { ...NO_STEPS, ...answer.steps },
      discount: Number(answer.discount ?? 0) || 0,
      reminders: (answer.reminders ?? []).map((row) => ({
        id: row.id,
        name: row.student_name,
        className: row.class_name,
        step: row.step,
        days: Number(row.days),
      })),
      recent: (answer.recent ?? []).map((row) => ({
        id: row.id,
        name: row.student_name,
        status: row.status,
        days: Number(row.days),
      })),
    },
  }
}

// Reads one of the signed-in agent's own students by opaque UUID (#539).
// Missing ids, malformed ids, and other agents' students all return the same
// `{ kind: "active", student: null }` after checking the agent's status.
export async function getAgentStudent(
  supabase: SupabaseClient,
  id: string,
): Promise<Result<AgentStudentResult, AgentStudentsError>> {
  const leadId = UUID.test(id) ? id : null
  const { data, error } = await readWithClockRetry(() => supabase.rpc("agent_student", { lead_id: leadId }))
  if (error) {
    console.error("Could not read a Discount code student", error)
    return { ok: false, error: "unavailable" }
  }
  const answer = data as DetailAnswer
  if (!answer) return { ok: false, error: "not-agent" }
  if (answer.state !== "active") {
    const kind = STATES[answer.state]
    if (!kind) {
      console.error("Unknown Discount code account state", answer.state)
      return { ok: false, error: "unavailable" }
    }
    return { ok: true, data: { kind } }
  }
  if (!answer.student) return { ok: true, data: { kind: "active", student: null } }
  return {
    ok: true,
    data: {
      kind: "active",
      student: {
        ...mapStudent(answer.student),
        reminder:
          answer.student.reminder_step && answer.student.reminder_days !== null
            ? { step: answer.student.reminder_step, days: Number(answer.student.reminder_days) }
            : null,
      },
    },
  }
}
