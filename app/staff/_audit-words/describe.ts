import { EXPORT_COLUMNS } from "@/lib/export-columns"
import type { LeadHistoryEntry } from "@/lib/services/audit"
import { SUPER_ADMIN_ROLE_ID, describeAuditRow, type HistoryLookup } from "@/lib/services/staff-admin"
import { AUDIT_AREAS, auditChanges, type AuditArea, type AuditEntry } from "@/lib/services/system-audit"
import type { AuditLookups } from "@/lib/services/system-audit-lookups"

import { BATCH_STOP_SHORT_LABELS } from "../agents/invite-batch-outcome"
import { agentRecordHref } from "../agents/outcome"
import { becauseText } from "../applicants/[id]/history/because"
import { LEAD_HISTORY_LABELS, describeLeadAuditEntry } from "../applicants/[id]/history/describe"
import { capitalize, formatAuditDate, formatAuditTime, formatOnOff, formatPercent, formatRawScalar, formatTzs, formatYesNo } from "./format"
import { AUDIT_ACTION_FIELDS, AUDIT_TABLE_FIELDS, type FieldSpec } from "./schema"

export type { AuditLookups }

// Plain-word description of every entry on /staff/audit (#504).
// Reuses Application history, Staff and roles history, and the approved word
// list for all 41 audited tables and 7 action kinds.

export const EMPTY_AUDIT_LOOKUPS: AuditLookups = {
  leads: {},
  contacts: {},
  contactLeads: {},
  streams: {},
  streamRequests: {},
  agents: {},
  inviteBatches: {},
  promoCodes: {},
  importBatches: {},
  staff: {},
  roles: {},
  permissions: {},
  managedPairs: {},
  discountRequests: {},
  feeSchedules: {},
  feeBandAmounts: {},
  classSeats: {},
  groupLinks: {},
  siblingGroups: {},
}

export type AuditFieldLine = { label: string; from: string | null; to: string }
export type AuditDetailLine = { field: string; from: string | null; to: string }
export type AuditRecordInfo = { kind: "Applicant" | "Agent" | "Name"; title: string; subtitle: string | null }
export type AuditRecordLink = { label: string; href: string }

export type DescribedAuditEntry = {
  id: number
  at: string
  when: string
  actor: string
  area: AuditArea
  areaLabel: string
  event: string
  record: AuditRecordInfo
  changes: AuditFieldLine[]
  unknownCount: number
  details: {
    action: string
    table: string | null
    rowId: string | null
    fields: AuditDetailLine[]
  }
  link: AuditRecordLink | null
}

const AREA_LABELS: Readonly<Record<AuditArea, string>> = Object.fromEntries(
  AUDIT_AREAS.map((area) => [area.value, area.label]),
) as Record<AuditArea, string>

const LEAD_HISTORY_TABLES = new Set([
  "leads",
  "guardian_contacts",
  "interviews",
  "follow_ups",
  "follow_up_records",
  "re_applications",
  "reopening_requests",
  "discount_requests",
  "lead_fee_profiles",
  "lead_sibling_results",
  "sibling_fee_edits",
  "sibling_group_members",
  "school_fee_payments",
  "payment_adjustments",
  "seat_placements",
  "stream_requests",
  "whatsapp_group_invitations",
])

const LEAD_HISTORY_RECORD: Readonly<Record<string, string>> = {
  leads: "lead",
  guardian_contacts: "contact",
}

const STAFF_ADMIN_TABLES = new Set(["staff_members", "roles", "role_managed_roles"])
const STAFF_ADMIN_ACTIONS = new Set(["invite_sent", "password_reset_sent", "hosted_reset", "roles_became_templates"])

const BAND_LABELS: Readonly<Record<string, string>> = {
  nursery: "Nursery",
  primary_lower: "Primary, lower",
  primary_upper: "Primary, upper",
  secondary: "Secondary",
}

const SEAT_MODES: Readonly<Record<string, string>> = {
  legacy: "Class, before streams",
  named: "Named streams",
}

const AGENT_STATUS_CHANGE_KINDS: Readonly<Record<string, string>> = {
  switched_off: "Switched off",
  switched_on: "Switched on",
  retired: "Retired",
  recreated: "Made again",
}

const AGENT_EVENT_KINDS: Readonly<Record<string, string>> = {
  invite: "Invite",
  reset: "Password reset link",
  claim: "Email claim check",
}

const AGENT_EVENT_RESULTS: Readonly<Record<string, string>> = {
  started: "Sending started",
  sent: "Sent",
  rate_limited: "Not sent: too many emails just now",
  smtp_error: "Not sent: the email server failed",
  rejected_address: "Not sent: the address was refused",
  other_error: "Not sent: the email service gave an error",
  access_off: "Not sent: agent access is off",
  no_match: "No agent matches",
  phone_mismatch: "The phone does not match",
  name_mismatch: "The name does not match",
}

const EMAIL_CLAIM_OUTCOMES: Readonly<Record<string, string>> = {
  pending: "Waiting for a decision",
  competing: "Another claim names the same email",
  confirmed: "Confirmed",
  rejected: "Rejected",
  auto_rejected: "Rejected automatically",
}

const DISCOUNT_CHANGE_KINDS: Readonly<Record<string, string>> = {
  standard: "The Standard discount",
  agent: "An agent’s interview discount",
  promo_amount: "A Promo code’s amount",
  promo_state: "A Promo code paused, resumed or ended",
  promo_created: "A new Promo code",
  promo_ends: "A Promo code’s end date",
}

const PROMO_STATES: Readonly<Record<string, string>> = {
  active: "Active",
  paused: "Paused",
  ended: "Ended",
}

const IMPORT_KINDS: Readonly<Record<string, string>> = {
  agents: "Agents",
  students: "Students",
}

const EXPORT_KINDS: Readonly<Record<string, string>> = {
  students: "Students",
}

const EXPORT_COLUMN_HEADERS: Readonly<Record<string, string>> = Object.fromEntries(
  EXPORT_COLUMNS.map((c) => [c.key, c.header]),
)

const EXPORT_FILTER_LABELS: Readonly<Record<string, string>> = {
  query: "Search",
  status: LEAD_HISTORY_LABELS.status,
  closure: LEAD_HISTORY_LABELS.closure,
  earlier_link_year: "WhatsApp group link year",
  class_name: LEAD_HISTORY_LABELS.class_name,
  enrollment_year: LEAD_HISTORY_LABELS.enrollment_year,
  import_batch_id: "From the import",
}

const TABLE_NAMES: Readonly<Record<string, string>> = {
  leads: "Application",
  guardian_contacts: "Parent or guardian",
  interviews: "Interview",
  follow_ups: "Follow-up",
  follow_up_records: "Follow-up contact",
  re_applications: "Re-application",
  reopening_requests: "Reopening request",
  discount_requests: "Discount request",
  lead_fee_profiles: "Fee details",
  lead_sibling_results: "Sibling discount",
  sibling_fee_edits: "Sibling fee change",
  sibling_group_members: "Sibling group member",
  sibling_groups: "Sibling group",
  school_fee_payments: "School-fee payment",
  payment_adjustments: "Payment correction",
  seat_placements: "Seat",
  stream_requests: "Stream request",
  whatsapp_group_invitations: "WhatsApp group invitation",
  fee_schedules: "Fee schedule",
  fee_band_amounts: "Fee amounts",
  class_seats: "Class seats",
  streams: "Stream",
  seat_settings: "Seat rules",
  sibling_rule_settings: "Sibling discount switch",
  whatsapp_group_links: "WhatsApp group link",
  sms_settings: "SMS limits",
  marketing_agents: "Agent",
  agent_status_changes: "Agent switched off, on or retired",
  agent_events: "Agent email",
  agent_invite_batches: "Agent invite batch",
  agent_email_claims: "Agent email claim",
  agent_sign_in_removals: "Agent sign-in removed",
  agent_access_settings: "Agent access",
  discount_amount_changes: "Discount amount change",
  interview_discount_setting: "Standard discount",
  promo_codes: "Promo code",
  import_batches: "Import",
  export_log: "Export",
  staff_members: "Staff member",
  roles: "Role",
  role_managed_roles: "Roles a role manages",
}

function isEmptyInsertValue(value: unknown): boolean {
  return value === null || value === undefined || value === false
}

function leadDisplay(id: unknown, lookups: AuditLookups): string {
  if (typeof id !== "string") return formatRawScalar(id)
  const found = lookups.leads[id]
  return found ? `${found.name} · ${found.admissionNumber}` : id
}

function agentDisplay(id: unknown, lookups: AuditLookups): string {
  if (typeof id !== "string") return formatRawScalar(id)
  const found = lookups.agents[id]
  return found ? `${found.name} · ${found.code}` : id
}

function formatExportFilters(value: unknown, lookups: AuditLookups): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return formatRawScalar(value)
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== "")
  if (entries.length === 0) return "None"
  return entries
    .map(([key, val]) => {
      const label = EXPORT_FILTER_LABELS[key] ?? key
      const rendered =
        key === "import_batch_id" && typeof val === "string"
          ? (lookups.importBatches[val]?.fileName ?? val)
          : formatRawScalar(val)
      return `${label}: ${rendered}`
    })
    .join(", ")
}

function formatTableValue(
  table: string,
  field: string,
  value: unknown,
  lookups: AuditLookups,
  entryValues: Record<string, unknown>,
): string {
  if (value === null || value === undefined) return field === "whatsapp" ? "Same as phone" : "None"
  switch (table) {
    case "sibling_groups":
      if (field === "full_payer_lead_id") return leadDisplay(value, lookups)
      if (field === "cause") return becauseText("group", value) ?? formatRawScalar(value)
      if (field === "contact_ids" && Array.isArray(value)) {
        return value.map((id) => lookups.contacts[String(id)] ?? String(id)).join(", ") || "None"
      }
      return formatRawScalar(value)

    case "fee_schedules":
      if (field === "first_share" || field === "second_share" || field === "third_share") return formatPercent(value)
      if (field === "first_due" || field === "second_due" || field === "third_due" || field === "academic_year_start") {
        return formatAuditDate(value)
      }
      if (field === "minimum_deposit" || field === "pre_form_one_day_fee" || field === "pre_form_one_boarding_fee") {
        return formatTzs(value)
      }
      return formatRawScalar(value)

    case "fee_band_amounts":
      if (field === "band") return BAND_LABELS[String(value)] ?? formatRawScalar(value)
      if (field === "day_fee" || field === "boarding_fee") return formatTzs(value)
      return formatRawScalar(value)

    case "streams":
      if (field === "request_id" && typeof value === "string") {
        const req = lookups.streamRequests[value]
        if (req?.leadId) return leadDisplay(req.leadId, lookups)
        if (req) return `${req.className} ${req.year}`
        return value
      }
      if (field === "brought_up_from" && typeof value === "string") {
        const prev = lookups.streams[value]
        return prev ? `${prev.name} ${prev.year}` : value
      }
      return formatRawScalar(value)

    case "seat_settings":
      if (field === "mode") return SEAT_MODES[String(value)] ?? formatRawScalar(value)
      return formatRawScalar(value)

    case "sibling_rule_settings":
      if (field === "new_grants_paused") return value ? "Paused" : "On"
      return formatRawScalar(value)

    case "marketing_agents":
      if (field === "registered_at" || field === "retired_at" || field === "switched_off_at") {
        return typeof value === "string" ? formatAuditTime(value) : formatRawScalar(value)
      }
      if (field === "user_id") return "Linked"
      if (field === "interview_discount") return formatTzs(value)
      return formatRawScalar(value)

    case "agent_status_changes":
      if (field === "kind") return AGENT_STATUS_CHANGE_KINDS[String(value)] ?? formatRawScalar(value)
      if (field === "old_agent_id" || field === "new_agent_id") return agentDisplay(value, lookups)
      return formatRawScalar(value)

    case "agent_events":
      if (field === "kind") return AGENT_EVENT_KINDS[String(value)] ?? formatRawScalar(value)
      if (field === "result") return AGENT_EVENT_RESULTS[String(value)] ?? formatRawScalar(value)
      if (field === "batch_id" && typeof value === "string") {
        const batch = lookups.inviteBatches[value]
        return batch ? `Invite batch started ${formatAuditTime(batch.startedAt)}` : value
      }
      return formatRawScalar(value)

    case "agent_invite_batches":
      if (field === "import_batch_id" && typeof value === "string") {
        return lookups.importBatches[value]?.fileName ?? value
      }
      if (field === "stop_reason") {
        return BATCH_STOP_SHORT_LABELS[value as keyof typeof BATCH_STOP_SHORT_LABELS] ?? formatRawScalar(value)
      }
      return formatRawScalar(value)

    case "agent_email_claims":
      if (field === "outcome") return EMAIL_CLAIM_OUTCOMES[String(value)] ?? formatRawScalar(value)
      return formatRawScalar(value)

    case "agent_sign_in_removals":
      if (field === "joined_at") return typeof value === "string" ? formatAuditTime(value) : formatRawScalar(value)
      if (field === "close_email") return formatYesNo(value)
      return formatRawScalar(value)

    case "agent_access_settings":
      if (field === "enabled" || field === "self_confirm_enabled") return formatOnOff(value)
      return formatRawScalar(value)

    case "discount_amount_changes":
      if (field === "kind") return DISCOUNT_CHANGE_KINDS[String(value)] ?? formatRawScalar(value)
      if (field === "agent_id") return agentDisplay(value, lookups)
      if (field === "promo_code_id" && typeof value === "string") return lookups.promoCodes[value]?.code ?? value
      if (field === "old_value" || field === "new_value") {
        const kind = String(entryValues.kind ?? "")
        if (kind === "promo_state") return PROMO_STATES[String(value)] ?? formatRawScalar(value)
        if (kind === "promo_ends") return formatAuditDate(value)
        if (kind === "standard" || kind === "agent" || kind === "promo_amount" || kind === "promo_created") {
          return formatTzs(value)
        }
      }
      return formatRawScalar(value)

    case "interview_discount_setting":
      if (field === "amount") return formatTzs(value)
      return formatRawScalar(value)

    case "promo_codes":
      if (field === "amount") return formatTzs(value)
      if (field === "ends_on") return formatAuditDate(value)
      if (field === "state") return PROMO_STATES[String(value)] ?? formatRawScalar(value)
      return formatRawScalar(value)

    case "import_batches":
      if (field === "kind") return IMPORT_KINDS[String(value)] ?? formatRawScalar(value)
      return formatRawScalar(value)

    case "export_log":
      if (field === "kind") return EXPORT_KINDS[String(value)] ?? formatRawScalar(value)
      if (field === "columns" && Array.isArray(value)) {
        return value.map((col) => EXPORT_COLUMN_HEADERS[String(col)] ?? String(col)).join(", ") || "None"
      }
      if (field === "filters") return formatExportFilters(value, lookups)
      return formatRawScalar(value)

    default:
      return formatRawScalar(value)
  }
}

function summarizeNonLeadTable(entry: AuditEntry, lookups: AuditLookups): string {
  const table = entry.table ?? ""
  const newValues = entry.newValues ?? {}
  const insert = entry.action === "insert"
  const update = entry.action === "update"

  switch (table) {
    case "sibling_groups":
      return insert ? "Made a sibling group" : update ? "Changed a sibling group" : capitalize(entry.action)

    case "fee_schedules": {
      const year = newValues.enrollment_year ?? (entry.recordId ? lookups.feeSchedules[entry.recordId]?.year : undefined)
      const suffix = year ? ` for ${year}` : ""
      return insert ? `Set the fee schedule${suffix}` : update ? `Changed the fee schedule${suffix}` : capitalize(entry.action)
    }

    case "fee_band_amounts": {
      const info = entry.recordId ? lookups.feeBandAmounts[entry.recordId] : undefined
      const bandKey = String(newValues.band ?? info?.band ?? "")
      const band = BAND_LABELS[bandKey]
      const year = newValues.enrollment_year ?? info?.year
      const suffix = band && year ? ` for ${band} in ${year}` : band ? ` for ${band}` : year ? ` in ${year}` : ""
      return insert ? `Set the fees${suffix}` : update ? `Changed the fees${suffix}` : capitalize(entry.action)
    }

    case "class_seats": {
      const info = entry.recordId ? lookups.classSeats[entry.recordId] : undefined
      const cls = newValues.class_name ?? info?.className
      const db = newValues.day_or_boarding ?? info?.dayOrBoarding
      const year = newValues.enrollment_year ?? info?.year
      const parts = [cls, db, year].filter(Boolean).join(", ")
      const suffix = parts ? ` for ${parts}` : ""
      return insert ? `Set the seats${suffix}` : update ? `Changed the seats${suffix}` : capitalize(entry.action)
    }

    case "streams": {
      const stream = entry.recordId ? lookups.streams[entry.recordId] : undefined
      const label =
        stream?.name ??
        ([newValues.class_name, newValues.label].filter(Boolean).join(" ") || "")
      const suffix = label ? ` ${label}` : ""
      return insert ? `Opened the stream${suffix}` : update ? `Changed the stream${suffix}` : capitalize(entry.action)
    }

    case "seat_settings":
      return "Changed how seats are counted"

    case "sibling_rule_settings":
      if (newValues.new_grants_paused === true) return "Paused new Sibling 10% grants"
      if (newValues.new_grants_paused === false) return "Switched new Sibling 10% grants back on"
      return "Changed the Sibling discount switch"

    case "whatsapp_group_links": {
      const year = newValues.enrollment_year ?? (entry.recordId ? lookups.groupLinks[entry.recordId]?.year : undefined)
      const suffix = year ? ` for ${year}` : ""
      return insert ? `Set the WhatsApp group link${suffix}` : update ? `Changed the WhatsApp group link${suffix}` : capitalize(entry.action)
    }

    case "sms_settings":
      return "Changed the SMS limits"

    case "marketing_agents": {
      const agent = entry.recordId ? lookups.agents[entry.recordId] : undefined
      const name = agent?.name ?? (typeof newValues.full_name === "string" ? newValues.full_name : null)
      if (insert) return name ? `Added the agent ${name}` : "Added an agent"
      if (update && newValues.status === "Approved") return "Approved the agent"
      if (update) return name ? `Changed the agent ${name}` : "Changed the agent"
      return capitalize(entry.action)
    }

    case "agent_status_changes":
      switch (newValues.kind) {
        case "switched_off":
          return "Switched off the agent"
        case "switched_on":
          return "Switched on the agent"
        case "retired":
          return "Retired the agent"
        case "recreated":
          return "Made the agent again"
        default:
          return capitalize(entry.action)
      }

    case "agent_events":
      switch (newValues.kind) {
        case "invite":
          return newValues.result === "sent" || newValues.result === "started"
            ? "Sent an agent invite"
            : "Sent an agent invite that failed"
        case "reset":
          return "Sent an agent a password reset link"
        case "claim":
          return "Checked an email claim"
        default:
          return capitalize(entry.action)
      }

    case "agent_invite_batches":
      if (insert) return "Started an agent invite batch"
      if (update && (newValues.finished_at || newValues.stop_reason)) return "Finished an agent invite batch"
      return update ? "Changed an agent invite batch" : capitalize(entry.action)

    case "agent_email_claims":
      switch (newValues.outcome) {
        case "confirmed":
          return "Confirmed the email claim"
        case "rejected":
        case "auto_rejected":
          return "Rejected the email claim"
        default:
          return "Claimed an agent email"
      }

    case "agent_sign_in_removals":
      return "Removed the agent’s sign-in"

    case "agent_access_settings":
      if (newValues.enabled === true) return "Turned agent access on"
      if (newValues.enabled === false) return "Turned agent access off"
      if ("self_confirm_enabled" in newValues) return "Changed agent self-confirm"
      return "Changed agent access"

    case "discount_amount_changes":
      switch (newValues.kind) {
        case "standard":
          return "Changed the Standard discount"
        case "agent":
          return "Changed an agent’s interview discount"
        default:
          return "Changed a Promo code"
      }

    case "interview_discount_setting":
      return "Changed the Standard discount"

    case "promo_codes": {
      const code =
        (typeof newValues.code === "string" ? newValues.code : null) ??
        (entry.recordId ? lookups.promoCodes[entry.recordId]?.code : null)
      const suffix = code ? ` ${code}` : ""
      return insert ? `Added the Promo code${suffix}` : update ? `Changed the Promo code${suffix}` : capitalize(entry.action)
    }

    case "import_batches": {
      const count = typeof newValues.row_count === "number" ? newValues.row_count : Number(newValues.row_count ?? 0)
      const file = typeof newValues.file_name === "string" ? newValues.file_name : ""
      const unit = newValues.kind === "agents" ? (count === 1 ? "agent" : "agents") : count === 1 ? "student" : "students"
      return file ? `Imported ${count} ${unit} from ${file}` : `Imported ${count} ${unit}`
    }

    case "export_log": {
      const count = typeof newValues.row_count === "number" ? newValues.row_count : Number(newValues.row_count ?? 0)
      return `Exported ${count} ${count === 1 ? "student" : "students"}`
    }

    default:
      return entry.table ? `${entry.action} on ${entry.table}` : entry.action
  }
}

function summarizeStaffAdmin(entry: AuditEntry, lookups: AuditLookups, baseSummary: string): string {
  const newValues = entry.newValues ?? {}
  if (entry.action === "invite_sent") return "Sent a staff invite"
  if (entry.table === "staff_members" && entry.action === "update") {
    const keys = Object.keys(newValues)
    if (keys.length === 1 && keys[0] === "notices_seen_at") return "Read their sign-in notices"
    if (keys.length === 1 && keys[0] === "role_id") return "Changed a staff member’s role"
    if (keys.length === 1 && keys[0] === "active" && newValues.active === false) return "Deactivated a staff member"
  }
  return capitalize(baseSummary)
}

function formatPermissionsChange(
  oldValue: unknown,
  newValue: unknown,
  permissions: Readonly<Record<string, string>>,
): { from: string | null; to: string } {
  const label = (p: unknown) => permissions[String(p)] ?? String(p)
  const after = Array.isArray(newValue) ? newValue.map(String) : []
  if (Array.isArray(oldValue)) {
    const before = oldValue.map(String)
    const beforeSet = new Set(before)
    const afterSet = new Set(after)
    const added = after.filter((p) => !beforeSet.has(p)).map(label)
    const removed = before.filter((p) => !afterSet.has(p)).map(label)
    const parts: string[] = []
    if (added.length > 0) parts.push(`Added: ${added.join(", ")}`)
    if (removed.length > 0) parts.push(`Removed: ${removed.join(", ")}`)
    if (parts.length > 0) return { from: null, to: parts.join(" · ") }
  }
  return { from: null, to: after.map(label).join(", ") || "None" }
}

function resolveRecordAndLink(entry: AuditEntry, lookups: AuditLookups): { record: AuditRecordInfo; link: AuditRecordLink | null } {
  const table = entry.table
  const newValues = entry.newValues ?? {}
  const areaLabel = AREA_LABELS[entry.area] ?? entry.area

  // 1. Lead-scoped records (including result_released and seat_priority_changed).
  if (entry.leadId) {
    const lead = lookups.leads[entry.leadId]
    const title = lead?.name ?? entry.admissionNumber ?? "Application"
    const subtitle = lead?.admissionNumber ?? entry.admissionNumber ?? null
    return {
      record: { kind: "Applicant", title, subtitle },
      link: { label: "Open the application", href: `/staff/applicants/${entry.leadId}/history` },
    }
  }

  // 2. Parent or guardian contact.
  if (table === "guardian_contacts" && entry.recordId) {
    const linkedLead = lookups.contactLeads[entry.recordId]
    if (linkedLead) {
      return {
        record: { kind: "Applicant", title: linkedLead.name, subtitle: linkedLead.admissionNumber },
        link: { label: "Open the application", href: `/staff/applicants/${linkedLead.id}/history` },
      }
    }
    const name = lookups.contacts[entry.recordId] ?? (typeof newValues.full_name === "string" ? newValues.full_name : "Parent or guardian")
    return { record: { kind: "Name", title: name, subtitle: "Parent or guardian" }, link: null }
  }

  // 3. Sibling group.
  if (table === "sibling_groups" && entry.recordId) {
    const payerId =
      (typeof newValues.full_payer_lead_id === "string" ? newValues.full_payer_lead_id : null) ??
      lookups.siblingGroups[entry.recordId]?.fullPayerLeadId ??
      null
    if (payerId && lookups.leads[payerId]) {
      const lead = lookups.leads[payerId]
      return {
        record: { kind: "Applicant", title: lead.name, subtitle: lead.admissionNumber },
        link: { label: "Open the application", href: `/staff/applicants/${payerId}/history` },
      }
    }
    return { record: { kind: "Name", title: "Sibling group", subtitle: "Applicants" }, link: null }
  }

  // 4. Whole-class stream request (no lead_id).
  if (table === "stream_requests") {
    const info = entry.recordId ? lookups.streamRequests[entry.recordId] : undefined
    const cls = (typeof newValues.class_name === "string" ? newValues.class_name : null) ?? info?.className ?? "Stream request"
    const year = newValues.enrollment_year ?? info?.year ?? null
    return {
      record: { kind: "Name", title: cls, subtitle: year ? String(year) : "Seats" },
      link: { label: "Open Seats", href: year ? `/staff/seats?year=${year}` : "/staff/seats" },
    }
  }

  // 5. Agent records and agent-linked tables.
  if (
    table === "marketing_agents" ||
    table === "agent_status_changes" ||
    table === "agent_events" ||
    table === "agent_email_claims" ||
    table === "agent_sign_in_removals"
  ) {
    const agentId = table === "marketing_agents" ? entry.recordId : typeof newValues.agent_id === "string" ? newValues.agent_id : null
    const agent = agentId ? lookups.agents[agentId] : undefined
    const name = agent?.name ?? (typeof newValues.full_name === "string" ? newValues.full_name : TABLE_NAMES[table] ?? "Agent")
    const code = agent?.code ?? (typeof newValues.code === "string" ? newValues.code : null)
    return {
      record: { kind: "Agent", title: name, subtitle: code ?? "Agents" },
      link: code
        ? { label: "Open the agent", href: agentRecordHref(code, agent?.retired ?? false) }
        : { label: "Open Agents", href: "/staff/agents" },
    }
  }

  // 6. Agent invite batches.
  if (table === "agent_invite_batches") {
    const startedAt =
      (typeof newValues.started_at === "string" ? newValues.started_at : null) ??
      (entry.recordId ? lookups.inviteBatches[entry.recordId]?.startedAt : null)
    const subtitle = startedAt ? `Started ${formatAuditTime(startedAt)}` : "Agents"
    return {
      record: { kind: "Name", title: "Invite batch", subtitle },
      link: entry.recordId
        ? { label: "Open the batch on Agents", href: `/staff/agents?status=all&batch=${entry.recordId}` }
        : { label: "Open Agents", href: "/staff/agents" },
    }
  }

  // 7. Agent access & Standard discount.
  if (table === "agent_access_settings") {
    return {
      record: { kind: "Name", title: "Agent access", subtitle: "Agents" },
      link: { label: "Open Agents", href: "/staff/agents" },
    }
  }
  if (table === "interview_discount_setting") {
    return {
      record: { kind: "Name", title: "Standard discount", subtitle: "Agents" },
      link: { label: "Open Agents", href: "/staff/agents" },
    }
  }

  // 8. Discount amount changes.
  if (table === "discount_amount_changes") {
    if (typeof newValues.agent_id === "string") {
      const agent = lookups.agents[newValues.agent_id]
      if (agent) {
        return {
          record: { kind: "Agent", title: agent.name, subtitle: agent.code },
          link: { label: "Open the agent", href: agentRecordHref(agent.code, agent.retired) },
        }
      }
    }
    if (typeof newValues.promo_code_id === "string") {
      const promo = lookups.promoCodes[newValues.promo_code_id]
      return {
        record: { kind: "Name", title: promo?.code ?? "Promo code", subtitle: "Promo codes" },
        link: { label: "Open Promo codes", href: "/staff/promo-codes" },
      }
    }
    return {
      record: { kind: "Name", title: "Standard discount", subtitle: "Agents" },
      link: { label: "Open Agents", href: "/staff/agents" },
    }
  }

  // 9. Promo codes.
  if (table === "promo_codes") {
    const promo = entry.recordId ? lookups.promoCodes[entry.recordId] : undefined
    const code = promo?.code ?? (typeof newValues.code === "string" ? newValues.code : "Promo code")
    return {
      record: { kind: "Name", title: code, subtitle: "Promo codes" },
      link: { label: "Open Promo codes", href: "/staff/promo-codes" },
    }
  }

  // 10. Fee schedules & bands.
  if (table === "fee_schedules" || table === "fee_band_amounts") {
    const year =
      newValues.enrollment_year ??
      (entry.recordId && table === "fee_schedules" ? lookups.feeSchedules[entry.recordId]?.year : undefined) ??
      (entry.recordId && table === "fee_band_amounts" ? lookups.feeBandAmounts[entry.recordId]?.year : undefined)
    const bandKey =
      (typeof newValues.band === "string" ? newValues.band : null) ??
      (entry.recordId && table === "fee_band_amounts" ? lookups.feeBandAmounts[entry.recordId]?.band : null)
    const title = table === "fee_band_amounts" && bandKey ? (BAND_LABELS[bandKey] ?? bandKey) : "Fee schedule"
    return {
      record: { kind: "Name", title, subtitle: year ? String(year) : "Fee schedule" },
      link: { label: "Open Fee schedule", href: year ? `/staff/fees/${year}` : "/staff/fees" },
    }
  }

  // 11. Seats & streams.
  if (table === "streams" || table === "class_seats" || table === "seat_settings" || entry.action === "streams_activated") {
    if (table === "streams" && entry.recordId) {
      const stream = lookups.streams[entry.recordId]
      const title = stream?.name ?? ([newValues.class_name, newValues.label].filter(Boolean).join(" ") || "Stream")
      const year = stream?.year ?? newValues.enrollment_year
      return {
        record: { kind: "Name", title, subtitle: year ? String(year) : "Seats" },
        link: { label: "Open Seats", href: year ? `/staff/seats?year=${year}` : "/staff/seats" },
      }
    }
    if (table === "class_seats") {
      const info = entry.recordId ? lookups.classSeats[entry.recordId] : undefined
      const cls = (typeof newValues.class_name === "string" ? newValues.class_name : null) ?? info?.className ?? "Class seats"
      const year = newValues.enrollment_year ?? info?.year
      return {
        record: { kind: "Name", title: cls, subtitle: year ? String(year) : "Seats" },
        link: { label: "Open Seats", href: year ? `/staff/seats?year=${year}` : "/staff/seats" },
      }
    }
    return {
      record: { kind: "Name", title: table ? (TABLE_NAMES[table] ?? table) : "Seats", subtitle: "Seats" },
      link: { label: "Open Seats", href: "/staff/seats" },
    }
  }

  // 12. WhatsApp group links.
  if (table === "whatsapp_group_links") {
    const year = newValues.enrollment_year ?? (entry.recordId ? lookups.groupLinks[entry.recordId]?.year : undefined)
    return {
      record: { kind: "Name", title: "WhatsApp group link", subtitle: year ? String(year) : "WhatsApp groups" },
      link: { label: "Open WhatsApp groups", href: "/staff/group-links" },
    }
  }

  // 13. Imports and exports.
  if (table === "import_batches") {
    const info = entry.recordId ? lookups.importBatches[entry.recordId] : undefined
    const fileName = (typeof newValues.file_name === "string" ? newValues.file_name : null) ?? info?.fileName ?? "Import"
    const kind = (typeof newValues.kind === "string" ? newValues.kind : null) ?? info?.kind
    if (kind === "agents") {
      return {
        record: { kind: "Name", title: fileName, subtitle: "Agents" },
        link: entry.recordId
          ? { label: "Open Agents", href: `/staff/agents?status=all&import=${entry.recordId}` }
          : { label: "Open Agents", href: "/staff/agents" },
      }
    }
    return {
      record: { kind: "Name", title: fileName, subtitle: "Applicants" },
      link: entry.recordId
        ? { label: "Open Applicants", href: `/staff/applicants?import=${entry.recordId}` }
        : { label: "Open Applicants", href: "/staff/applicants" },
    }
  }

  if (table === "export_log") {
    return {
      record: { kind: "Name", title: "Export", subtitle: "Students" },
      link: { label: "Open Applicants", href: "/staff/applicants" },
    }
  }

  // 14. Staff members and staff invite/reset actions.
  if (table === "staff_members" || entry.action === "invite_sent" || entry.action === "password_reset_sent") {
    const staffId = table === "staff_members" ? entry.recordId : typeof newValues.staff_member_id === "string" ? newValues.staff_member_id : null
    const member = staffId ? lookups.staff[staffId] : undefined
    const name = member?.name ?? (typeof newValues.full_name === "string" ? newValues.full_name : "Staff member")
    const href = member?.roleId && member.roleId !== SUPER_ADMIN_ROLE_ID ? `/staff/roles?role=${member.roleId}` : "/staff/roles"
    return {
      record: { kind: "Name", title: name, subtitle: "Staff" },
      link: { label: `Open ${name}`, href },
    }
  }

  // 15. Roles and managed sets.
  if (table === "roles" || table === "role_managed_roles" || entry.action === "roles_became_templates") {
    const roleId =
      table === "roles"
        ? entry.recordId
        : table === "role_managed_roles"
          ? ((typeof newValues.role_id === "string" ? newValues.role_id : null) ??
            (entry.recordId ? lookups.managedPairs[entry.recordId]?.roleId : null))
          : null
    const roleName =
      (roleId ? lookups.roles[roleId] : null) ??
      (typeof newValues.name === "string" ? newValues.name : null) ??
      "Roles"
    const href = roleId && roleId !== SUPER_ADMIN_ROLE_ID ? `/staff/roles?role=${roleId}` : "/staff/roles"
    return {
      record: { kind: "Name", title: roleName, subtitle: "Roles" },
      link: { label: "Open Roles", href },
    }
  }

  // 16. Settings without a dedicated staff screen (sibling_rule_settings, sms_settings, hosted_reset, unknown).
  return {
    record: { kind: "Name", title: table ? (TABLE_NAMES[table] ?? table) : entry.action, subtitle: areaLabel },
    link: null,
  }
}

function unknownFieldCount(entry: AuditEntry, specs: Readonly<Record<string, FieldSpec>> | undefined): number {
  if (!specs) return 0
  const newValues = entry.newValues ?? {}
  let count = 0
  for (const field of Object.keys(newValues)) {
    if (!(field in specs)) count += 1
  }
  return count
}

function buildStaffAdminLookup(lookups: AuditLookups): HistoryLookup {
  return {
    staffNames: new Map(Object.entries(lookups.staff).map(([id, s]) => [id, s.name])),
    roleNames: new Map([[SUPER_ADMIN_ROLE_ID, "Super Admin"], ...Object.entries(lookups.roles)]),
    permissionLabels: new Map(Object.entries(lookups.permissions)),
    managedPairs: new Map(Object.entries(lookups.managedPairs)),
  }
}

export function describeAuditEntry(entry: AuditEntry, lookups: AuditLookups = EMPTY_AUDIT_LOOKUPS): DescribedAuditEntry {
  const newValues = entry.newValues ?? {}
  const oldValues = entry.oldValues ?? {}
  const tableSpecs = entry.table ? AUDIT_TABLE_FIELDS[entry.table] : AUDIT_ACTION_FIELDS[entry.action]
  const details = {
    action: entry.action,
    table: entry.table,
    rowId: entry.recordId,
    fields: auditChanges(entry),
  }
  const { record, link } = resolveRecordAndLink(entry, lookups)
  const areaLabel = AREA_LABELS[entry.area] ?? entry.area
  const when = formatAuditTime(entry.at)

  // 1. Lead-scoped tables and lead action kinds (result_released, seat_priority_changed).
  const isLeadTable = entry.table !== null && LEAD_HISTORY_TABLES.has(entry.table)
  const isLeadAction = entry.table === null && (entry.action === "result_released" || entry.action === "seat_priority_changed")
  if (isLeadTable || isLeadAction) {
    const leadEntry: LeadHistoryEntry = {
      id: entry.id,
      at: entry.at,
      actor: entry.actor,
      record: entry.table === null ? null : (LEAD_HISTORY_RECORD[entry.table] ?? entry.table),
      recordId: entry.recordId,
      action: entry.action,
      changes: Object.keys(newValues)
        .filter((field) => !tableSpecs || field in tableSpecs)
        .filter((field) => !(field === "id" || field === "created_at" || field === "student_name_key"))
        .map((field) => ({ field, from: oldValues[field] ?? null, to: newValues[field] ?? null })),
    }
    const leadNames = Object.fromEntries(Object.entries(lookups.leads).map(([id, l]) => [id, `${l.name} · ${l.admissionNumber}`]))
    const streamNames = Object.fromEntries(Object.entries(lookups.streams).map(([id, s]) => [id, s.name]))
    const streamOpenedAt = Object.fromEntries(Object.entries(lookups.streams).map(([id, s]) => [id, s.openedAt]))
    const staffNames = Object.fromEntries(Object.entries(lookups.staff).map(([id, s]) => [id, s.name]))
    const discountKindById = new Map(Object.entries(lookups.discountRequests).map(([id, r]) => [id, r.kind]))
    const described = describeLeadAuditEntry(leadEntry, {
      contactNames: { ...staffNames, ...lookups.contacts },
      leadNames,
      streamNames,
      streamOpenedAt,
      discountKindById,
    })
    return {
      id: entry.id,
      at: entry.at,
      when,
      actor: entry.actor,
      area: entry.area,
      areaLabel,
      event: capitalize(described.summary),
      record,
      changes: described.changes.map(({ label, from, to }) => ({ label, from, to })),
      unknownCount: unknownFieldCount(entry, tableSpecs),
      details,
      link,
    }
  }

  // 2. Staff and roles tables & actions (reusing describeAuditRow from lib/services/staff-admin.ts).
  if ((entry.table !== null && STAFF_ADMIN_TABLES.has(entry.table)) || (entry.table === null && STAFF_ADMIN_ACTIONS.has(entry.action))) {
    const staffLookup = buildStaffAdminLookup(lookups)
    const described = describeAuditRow(
      {
        id: entry.id,
        table_name: entry.table,
        row_id: entry.recordId,
        action: entry.action,
        old_values: entry.oldValues,
        new_values: entry.newValues,
        actor_kind: "staff",
        actor_staff_id: null,
        created_at: entry.at,
      },
      staffLookup,
    )
    const event = summarizeStaffAdmin(entry, lookups, described.summary)
    const changes: AuditFieldLine[] = []
    if (entry.action !== "hosted_reset" && entry.table !== "role_managed_roles") {
      for (const field of Object.keys(newValues)) {
        const spec = tableSpecs?.[field]
        if (!spec || spec.kind === "left_out") continue
        if (entry.action !== "update" && isEmptyInsertValue(newValues[field])) continue
        if (entry.table === "roles" && field === "permissions") {
          const perm = formatPermissionsChange(entry.action === "update" ? oldValues[field] : null, newValues[field], lookups.permissions)
          changes.push({ label: spec.label, from: perm.from, to: perm.to })
          continue
        }
        if (entry.action === "roles_became_templates" && field === "removed" && Array.isArray(newValues[field])) {
          changes.push({ label: spec.label, from: null, to: (newValues[field] as unknown[]).map(String).join(", ") || "None" })
          continue
        }
        const matched = described.changes.find((c) => c.field.toLowerCase() === spec.label.toLowerCase() || c.field === field)
        changes.push({
          label: spec.label,
          from: entry.action === "update" ? (matched?.from ?? formatRawScalar(oldValues[field])) : null,
          to: matched?.to ?? formatRawScalar(newValues[field]),
        })
      }
    }
    const unknownCount = entry.action === "hosted_reset" ? 0 : unknownFieldCount(entry, tableSpecs)
    return {
      id: entry.id,
      at: entry.at,
      when,
      actor: entry.actor,
      area: entry.area,
      areaLabel,
      event,
      record,
      changes,
      unknownCount,
      details,
      link,
    }
  }

  // 3. streams_activated action.
  if (entry.table === null && entry.action === "streams_activated") {
    const changes: AuditFieldLine[] = []
    for (const field of Object.keys(newValues)) {
      const spec = tableSpecs?.[field]
      if (!spec || spec.kind === "left_out") continue
      changes.push({ label: spec.label, from: null, to: formatRawScalar(newValues[field]) })
    }
    return {
      id: entry.id,
      at: entry.at,
      when,
      actor: entry.actor,
      area: entry.area,
      areaLabel,
      event: "Switched seats to named streams",
      record,
      changes,
      unknownCount: unknownFieldCount(entry, tableSpecs),
      details,
      link,
    }
  }

  // 4. All other audited tables (school-wide settings, agents, imports/exports, sibling_groups).
  const isUpdate = entry.action === "update"
  const changes: AuditFieldLine[] = []
  if (entry.table && tableSpecs) {
    for (const field of Object.keys(newValues)) {
      const spec = tableSpecs[field]
      if (!spec || spec.kind === "left_out") continue
      if (!isUpdate && isEmptyInsertValue(newValues[field])) continue
      changes.push({
        label: spec.label,
        from: isUpdate ? formatTableValue(entry.table, field, oldValues[field], lookups, newValues) : null,
        to: formatTableValue(entry.table, field, newValues[field], lookups, newValues),
      })
    }
  }

  return {
    id: entry.id,
    at: entry.at,
    when,
    actor: entry.actor,
    area: entry.area,
    areaLabel,
    event: summarizeNonLeadTable(entry, lookups),
    record,
    changes,
    unknownCount: unknownFieldCount(entry, tableSpecs),
    details,
    link,
  }
}

export function describeAuditEntries(entries: readonly AuditEntry[], lookups: AuditLookups = EMPTY_AUDIT_LOOKUPS): DescribedAuditEntry[] {
  return entries.map((entry) => describeAuditEntry(entry, lookups))
}
