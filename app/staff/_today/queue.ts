import type { Permission } from "@/lib/permissions"
import { formatDate } from "@/lib/school-calendar"
import { INTERVIEWS_NAMED } from "@/lib/services/today"

// Needs you today: the work waiting for the signed-in staff member, one row a
// kind, in this order. A row shows only to someone who may act on it, and
// only while its count is above zero.

export const QUEUE_ROW_KEYS = ["overdue", "interviews", "reApplications", "results", "agents", "discounts", "reopenings"] as const
export type QueueRowKey = (typeof QUEUE_ROW_KEYS)[number]

// Every permission a row needs: the one its work takes, and leads.view where
// the page it opens needs that too.
export const QUEUE_PERMISSIONS: Record<QueueRowKey, readonly Permission[]> = {
  overdue: ["leads.view", "follow_ups.record"],
  interviews: ["leads.view", "interviews.record"],
  reApplications: ["leads.view", "leads.edit"],
  results: ["leads.view", "results.send"],
  agents: ["leads.view", "agents.approve"],
  discounts: ["discounts.approve"],
  reopenings: ["leads.view", "reopenings.approve"],
}

export function mayActOn(key: QueueRowKey, permissions: readonly Permission[]): boolean {
  return QUEUE_PERMISSIONS[key].every((permission) => permissions.includes(permission))
}

// What was read for each row. A row left undefined was not read: the staff
// member may not act on it, or its read failed.
export type QueueInput = {
  overdue?: {
    count: number
    // The oldest item in the Overdue section: an open follow-up past its
    // date, or a reopened lead that still needs a follow-up date.
    oldest: { kind: "follow_up" | "needs_date"; studentName: string; dueOn: string } | null
  }
  interviews?: { count: number; students: string[]; year: number | null }
  reApplications?: { count: number }
  results?: { count: number; year: number | null }
  agents?: { count: number }
  discounts?: { count: number }
  reopenings?: { count: number }
}

export type QueueRow = {
  key: QueueRowKey
  href: string
  count: number
  // "8 follow-ups are overdue".
  title: string
  // One line under the title.
  detail: string
  // The row's part of the summary line: "8 overdue follow-ups".
  summary: string
}

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`
}

// The names the Interviews today row shows: up to the first three, and how
// many more there are.
export function namesLine(students: string[], count: number): string {
  const named = students.slice(0, INTERVIEWS_NAMED)
  const more = count - named.length
  if (named.length === 0) return "Interviews held today"
  return more > 0 ? `${named.join(" · ")} and ${plural(more, "more", "more")}` : named.join(" · ")
}

// The rows to show, in order, from what was read.
export function queueRows(input: QueueInput): QueueRow[] {
  const rows: QueueRow[] = []

  const overdue = input.overdue
  if (overdue && overdue.count > 0) {
    const oldest = overdue.oldest
    rows.push({
      key: "overdue",
      href: "/staff/follow-ups",
      count: overdue.count,
      title: overdue.count === 1 ? "1 follow-up is overdue" : `${overdue.count.toLocaleString("en-GB")} follow-ups are overdue`,
      detail: !oldest
        ? "Families waiting for a call"
        : oldest.kind === "needs_date"
          ? `Oldest: ${oldest.studentName}, reopened ${formatDate(oldest.dueOn)} with no follow-up date`
          : `Oldest: ${oldest.studentName}, due ${formatDate(oldest.dueOn)}`,
      summary: plural(overdue.count, "overdue follow-up", "overdue follow-ups"),
    })
  }

  const interviews = input.interviews
  if (interviews && interviews.count > 0) {
    rows.push({
      key: "interviews",
      href: interviews.year === null ? "/staff/interviews" : `/staff/interviews?year=${interviews.year}`,
      count: interviews.count,
      title: `${plural(interviews.count, "interview", "interviews")} today`,
      detail: namesLine(interviews.students, interviews.count),
      summary: `${plural(interviews.count, "interview", "interviews")} today`,
    })
  }

  const reApplications = input.reApplications
  if (reApplications && reApplications.count > 0) {
    rows.push({
      key: "reApplications",
      href: "/staff/re-applications",
      count: reApplications.count,
      title: `${plural(reApplications.count, "re-application", "re-applications")} to review`,
      detail: "Returning families who applied online",
      summary: `${plural(reApplications.count, "re-application", "re-applications")} to review`,
    })
  }

  const results = input.results
  if (results && results.count > 0) {
    rows.push({
      key: "results",
      href: results.year === null ? "/staff/interviews?release=ready" : `/staff/interviews?year=${results.year}&release=ready`,
      count: results.count,
      title: `${plural(results.count, "result", "results")} ready to send`,
      detail: "Interview fee paid, result not yet sent to the parent",
      summary: `${plural(results.count, "result", "results")} to send`,
    })
  }

  const agents = input.agents
  if (agents && agents.count > 0) {
    rows.push({
      key: "agents",
      href: "/staff/agents?status=pending",
      count: agents.count,
      title: `${plural(agents.count, "Marketing Agent", "Marketing Agents")} waiting for approval`,
      detail: "Referral codes that cannot be used until you approve them",
      summary: `${plural(agents.count, "agent", "agents")} to approve`,
    })
  }

  const discounts = input.discounts
  if (discounts && discounts.count > 0) {
    rows.push({
      key: "discounts",
      href: "/staff/discounts",
      count: discounts.count,
      title: `${plural(discounts.count, "Discount request", "Discount requests")} pending`,
      detail: "Staff child and Qualified orphan requests to grant or refuse",
      summary: `${plural(discounts.count, "discount request", "discount requests")}`,
    })
  }

  const reopenings = input.reopenings
  if (reopenings && reopenings.count > 0) {
    rows.push({
      key: "reopenings",
      href: "/staff/reopenings",
      count: reopenings.count,
      title: `${plural(reopenings.count, "Reopening request", "Reopening requests")} pending`,
      detail: "Closed applications that staff want back in work",
      summary: `${plural(reopenings.count, "reopening request", "reopening requests")}`,
    })
  }

  return rows
}

// The counts in one line under the greeting: "8 overdue follow-ups, 2
// re-applications to review, 5 results to send". Empty when nothing waits.
export function summaryLine(rows: readonly QueueRow[]): string {
  return rows.map((row) => row.summary).join(", ")
}
