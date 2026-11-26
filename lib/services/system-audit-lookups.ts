import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getInviteBatchReport } from "./agent-invite-batches"
import type { LeadClass } from "./leads"
import { SUPER_ADMIN_ROLE_ID } from "./staff-admin"
import { streamName, type StreamTakes } from "./streams"
import type { AuditActor, AuditEntry } from "./system-audit"

// Names looked up alongside one page of /staff/audit (#504), so entries name
// people, streams, agents, Promo codes, imports and roles instead of raw ids.
// Every lookup is optional decoration: a batch that fails leaves those entries
// unnamed rather than hiding the audit page.

export type FamilyMatchStep = { id: number; match: unknown }

export type AuditLookups = {
  leads: Readonly<Record<string, { name: string; admissionNumber: string }>>
  contacts: Readonly<Record<string, string>>
  contactLeads: Readonly<Record<string, { id: string; name: string; admissionNumber: string }>>
  familyMatchTimeline: Readonly<Record<string, readonly FamilyMatchStep[]>>
  streams: Readonly<Record<string, { name: string; year: number; openedAt: string }>>
  streamRequests: Readonly<Record<string, { leadId: string | null; className: string; year: number }>>
  agents: Readonly<Record<string, { name: string; code: string; retired: boolean }>>
  inviteBatches: Readonly<Record<string, { startedAt: string }>>
  promoCodes: Readonly<Record<string, { code: string; name: string }>>
  importBatches: Readonly<Record<string, { fileName: string; kind: string }>>
  staff: Readonly<Record<string, { name: string; roleId: string }>>
  roles: Readonly<Record<string, string>>
  permissions: Readonly<Record<string, string>>
  managedPairs: Readonly<Record<string, { roleId: string; managedRoleId: string }>>
  discountRequests: Readonly<Record<string, { kind: string; leadId: string }>>
  feeSchedules: Readonly<Record<string, { year: number }>>
  feeBandAmounts: Readonly<Record<string, { year: number; band: string }>>
  classSeats: Readonly<Record<string, { year: number; className: string; dayOrBoarding: string }>>
  groupLinks: Readonly<Record<string, { year: number }>>
  siblingGroups: Readonly<Record<string, { fullPayerLeadId: string | null }>>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BATCH = 100

function addUuid(set: Set<string>, value: unknown) {
  if (typeof value === "string" && UUID.test(value)) set.add(value)
}

function addFrom(set: Set<string>, entry: AuditEntry, field: string) {
  addUuid(set, entry.oldValues?.[field])
  addUuid(set, entry.newValues?.[field])
}

async function readById<Row extends { id: string }, Out>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  ids: readonly string[],
  map: (row: Row) => Out,
): Promise<Record<string, Out>> {
  if (ids.length === 0) return {}
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH))
  const results = await Promise.all(batches.map((batch) => supabase.from(table).select(columns).in("id", batch)))
  const out: Record<string, Out> = {}
  for (const { data, error } of results) {
    if (error) {
      console.error(`Could not read ${table} names for the audit page`, error)
      continue
    }
    for (const row of (data ?? []) as unknown as Row[]) out[row.id] = map(row)
  }
  return out
}

// Each contact's unconfirmed Family match over time, from its own audit_log
// rows (oldest first). Uses the caller's existing audit.view permission on
// audit_log so the Audit page reads Family confirmations the same way
// Application history does.
async function readFamilyMatchTimeline(
  supabase: SupabaseClient,
  contactIds: readonly string[],
): Promise<Record<string, FamilyMatchStep[]>> {
  if (contactIds.length === 0) return {}
  const batches: string[][] = []
  for (let i = 0; i < contactIds.length; i += BATCH) batches.push(contactIds.slice(i, i + BATCH))
  const results = await Promise.all(
    batches.map((batch) =>
      supabase
        .from("audit_log")
        .select("id, row_id, new_values")
        .eq("table_name", "guardian_contacts")
        .in("row_id", batch)
        .order("id", { ascending: true }),
    ),
  )
  const out: Record<string, FamilyMatchStep[]> = {}
  for (const { data, error } of results) {
    if (error) {
      console.error("Could not read guardian_contacts match history for the audit page", error)
      continue
    }
    for (const row of (data ?? []) as { id: number; row_id: string | null; new_values: Record<string, unknown> | null }[]) {
      if (!row.row_id || !row.new_values || !("pending_family_match_id" in row.new_values)) continue
      const list = (out[row.row_id] ??= [])
      list.push({ id: Number(row.id), match: row.new_values.pending_family_match_id ?? null })
    }
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.id - b.id)
  return out
}

export async function getAuditLookups(
  supabase: SupabaseClient,
  entries: readonly AuditEntry[],
  actors: readonly AuditActor[],
): Promise<AuditLookups> {
  const leadIds = new Set<string>()
  const contactIds = new Set<string>()
  const contactForLeadIds = new Set<string>()
  const matchContactIds = new Set<string>()
  const streamIds = new Set<string>()
  const streamRequestIds = new Set<string>()
  const agentIds = new Set<string>()
  const inviteBatchIds = new Set<string>()
  const promoCodeIds = new Set<string>()
  const importBatchIds = new Set<string>()
  const roleIds = new Set<string>()
  const managedPairIds = new Set<string>()
  const discountRequestIds = new Set<string>()
  const feeScheduleIds = new Set<string>()
  const feeBandIds = new Set<string>()
  const classSeatIds = new Set<string>()
  const groupLinkIds = new Set<string>()
  const siblingGroupIds = new Set<string>()
  let needPermissions = false

  const pageInviteBatches: Record<string, { startedAt: string }> = {}

  for (const entry of entries) {
    addUuid(leadIds, entry.leadId)
    const table = entry.table
    const newValues = entry.newValues ?? {}
    const oldValues = entry.oldValues ?? {}

    if (table === "leads") {
      addUuid(leadIds, entry.recordId)
      addFrom(contactIds, entry, "guardian_contact_id")
      addFrom(importBatchIds, entry, "import_batch_id")
      if (entry.action === "insert" && newValues.returning_family_joined === true) {
        addUuid(matchContactIds, newValues.guardian_contact_id)
      } else if (entry.action === "update" && "guardian_contact_id" in newValues) {
        addUuid(matchContactIds, oldValues.guardian_contact_id)
      }
    } else if (table === "guardian_contacts") {
      addUuid(contactIds, entry.recordId)
      if (!entry.leadId) addUuid(contactForLeadIds, entry.recordId)
      addFrom(contactIds, entry, "pending_family_match_id")
    } else if (table === "sibling_group_members") {
      addFrom(leadIds, entry, "sibling_of_lead_id")
    } else if (table === "sibling_groups") {
      addUuid(siblingGroupIds, entry.recordId)
      addFrom(leadIds, entry, "full_payer_lead_id")
      for (const list of [oldValues.contact_ids, newValues.contact_ids]) {
        if (Array.isArray(list)) for (const id of list) addUuid(contactIds, id)
      }
    } else if (table === "discount_requests") {
      addFrom(leadIds, entry, "sibling_of_lead_id")
      if (entry.action === "update") addUuid(discountRequestIds, entry.recordId)
    } else if (table === "seat_placements") {
      addFrom(streamIds, entry, "stream_id")
    } else if (table === "stream_requests") {
      addUuid(streamRequestIds, entry.recordId)
      addFrom(streamIds, entry, "resolved_by_stream_id")
    } else if (table === "streams") {
      addUuid(streamIds, entry.recordId)
      addFrom(streamRequestIds, entry, "request_id")
      addFrom(streamIds, entry, "brought_up_from")
    } else if (table === "fee_schedules") {
      addUuid(feeScheduleIds, entry.recordId)
    } else if (table === "fee_band_amounts") {
      addUuid(feeBandIds, entry.recordId)
    } else if (table === "class_seats") {
      addUuid(classSeatIds, entry.recordId)
    } else if (table === "whatsapp_group_links") {
      addUuid(groupLinkIds, entry.recordId)
    } else if (table === "marketing_agents") {
      addUuid(agentIds, entry.recordId)
    } else if (table === "agent_status_changes") {
      addFrom(agentIds, entry, "agent_id")
      addFrom(agentIds, entry, "old_agent_id")
      addFrom(agentIds, entry, "new_agent_id")
    } else if (table === "agent_events") {
      addFrom(agentIds, entry, "agent_id")
      addFrom(inviteBatchIds, entry, "batch_id")
    } else if (table === "agent_invite_batches") {
      if (entry.recordId && typeof newValues.started_at === "string") {
        pageInviteBatches[entry.recordId] = { startedAt: newValues.started_at }
      } else {
        addUuid(inviteBatchIds, entry.recordId)
      }
      addFrom(importBatchIds, entry, "import_batch_id")
    } else if (table === "agent_email_claims" || table === "agent_sign_in_removals") {
      addFrom(agentIds, entry, "agent_id")
    } else if (table === "discount_amount_changes") {
      addFrom(agentIds, entry, "agent_id")
      addFrom(promoCodeIds, entry, "promo_code_id")
    } else if (table === "promo_codes") {
      addUuid(promoCodeIds, entry.recordId)
    } else if (table === "import_batches") {
      addUuid(importBatchIds, entry.recordId)
    } else if (table === "export_log") {
      const filters = newValues.filters
      if (filters && typeof filters === "object" && !Array.isArray(filters)) {
        addUuid(importBatchIds, (filters as Record<string, unknown>).import_batch_id)
      }
    } else if (table === "staff_members") {
      addFrom(roleIds, entry, "role_id")
    } else if (table === "roles") {
      addUuid(roleIds, entry.recordId)
      needPermissions = true
    } else if (table === "role_managed_roles") {
      addUuid(managedPairIds, entry.recordId)
      addFrom(roleIds, entry, "role_id")
      addFrom(roleIds, entry, "managed_role_id")
    }
  }

  // Staff names and role ids already come from getAuditActors.
  const staff: Record<string, { name: string; roleId: string }> = {}
  for (const actor of actors) staff[actor.id] = { name: actor.name, roleId: actor.roleId ?? "" }

  const [
    leads,
    contacts,
    contactLeadsRaw,
    familyMatchTimeline,
    streams,
    streamRequests,
    agents,
    promoCodes,
    importBatches,
    roles,
    managedPairs,
    discountRequests,
    feeSchedules,
    feeBandAmounts,
    classSeats,
    groupLinks,
    siblingGroups,
    permissionsResult,
    batchReports,
  ] = await Promise.all([
    readById<{ id: string; student_name: string; admission_number: string }, { name: string; admissionNumber: string }>(
      supabase,
      "leads",
      "id, student_name, admission_number",
      [...leadIds],
      (r) => ({ name: r.student_name, admissionNumber: r.admission_number }),
    ),
    readById<{ id: string; full_name: string }, string>(supabase, "guardian_contacts", "id, full_name", [...contactIds], (r) => r.full_name),
    contactForLeadIds.size > 0
      ? supabase.from("leads").select("id, student_name, admission_number, guardian_contact_id").in("guardian_contact_id", [...contactForLeadIds])
      : Promise.resolve({ data: [], error: null }),
    readFamilyMatchTimeline(supabase, [...matchContactIds]),
    readById<
      { id: string; class_name: LeadClass; label: string; takes: StreamTakes; enrollment_year: number; opened_at: string },
      { name: string; year: number; openedAt: string }
    >(supabase, "streams", "id, class_name, label, takes, enrollment_year, opened_at", [...streamIds], (r) => ({
      name: streamName(r.class_name, r.label, r.takes),
      year: r.enrollment_year,
      openedAt: r.opened_at,
    })),
    readById<
      { id: string; lead_id: string | null; class_name: string; enrollment_year: number },
      { leadId: string | null; className: string; year: number }
    >(supabase, "stream_requests", "id, lead_id, class_name, enrollment_year", [...streamRequestIds], (r) => ({
      leadId: r.lead_id,
      className: r.class_name,
      year: r.enrollment_year,
    })),
    readById<
      { id: string; full_name: string; code: string; retired_at: string | null },
      { name: string; code: string; retired: boolean }
    >(supabase, "marketing_agents", "id, full_name, code, retired_at", [...agentIds], (r) => ({
      name: r.full_name,
      code: r.code,
      retired: r.retired_at !== null,
    })),
    readById<{ id: string; code: string; name: string }, { code: string; name: string }>(
      supabase,
      "promo_codes",
      "id, code, name",
      [...promoCodeIds],
      (r) => ({ code: r.code, name: r.name }),
    ),
    readById<{ id: string; file_name: string; kind: string }, { fileName: string; kind: string }>(
      supabase,
      "import_batches",
      "id, file_name, kind",
      [...importBatchIds],
      (r) => ({ fileName: r.file_name, kind: r.kind }),
    ),
    readById<{ id: string; name: string }, string>(supabase, "roles", "id, name", [...roleIds], (r) => r.name),
    readById<{ id: string; role_id: string; managed_role_id: string }, { roleId: string; managedRoleId: string }>(
      supabase,
      "role_managed_roles",
      "id, role_id, managed_role_id",
      [...managedPairIds],
      (r) => ({ roleId: r.role_id, managedRoleId: r.managed_role_id }),
    ),
    readById<{ id: string; kind: string; lead_id: string }, { kind: string; leadId: string }>(
      supabase,
      "discount_requests",
      "id, kind, lead_id",
      [...discountRequestIds],
      (r) => ({ kind: r.kind, leadId: r.lead_id }),
    ),
    readById<{ id: string; enrollment_year: number }, { year: number }>(
      supabase,
      "fee_schedules",
      "id, enrollment_year",
      [...feeScheduleIds],
      (r) => ({ year: r.enrollment_year }),
    ),
    readById<{ id: string; enrollment_year: number; band: string }, { year: number; band: string }>(
      supabase,
      "fee_band_amounts",
      "id, enrollment_year, band",
      [...feeBandIds],
      (r) => ({ year: r.enrollment_year, band: r.band }),
    ),
    readById<
      { id: string; enrollment_year: number; class_name: string; day_or_boarding: string },
      { year: number; className: string; dayOrBoarding: string }
    >(supabase, "class_seats", "id, enrollment_year, class_name, day_or_boarding", [...classSeatIds], (r) => ({
      year: r.enrollment_year,
      className: r.class_name,
      dayOrBoarding: r.day_or_boarding,
    })),
    readById<{ id: string; enrollment_year: number }, { year: number }>(
      supabase,
      "whatsapp_group_links",
      "id, enrollment_year",
      [...groupLinkIds],
      (r) => ({ year: r.enrollment_year }),
    ),
    readById<{ id: string; full_payer_lead_id: string | null }, { fullPayerLeadId: string | null }>(
      supabase,
      "sibling_groups",
      "id, full_payer_lead_id",
      [...siblingGroupIds],
      (r) => ({ fullPayerLeadId: r.full_payer_lead_id }),
    ),
    needPermissions ? supabase.from("permissions").select("name, label") : Promise.resolve({ data: [], error: null }),
    Promise.all(
      [...inviteBatchIds]
        .filter((id) => !(id in pageInviteBatches))
        .map(async (batchId) => {
          const report = await getInviteBatchReport(supabase, { batchId })
          return report.ok && report.data ? ([batchId, { startedAt: report.data.startedAt }] as const) : null
        }),
    ),
  ])

  // Follow-up names revealed by the first pass (e.g. a stream opened for a
  // child's stream request, a sibling group's full payer, or a managed-set pair's roles).
  const extraLeadIds = new Set<string>()
  for (const req of Object.values(streamRequests)) if (req.leadId && !(req.leadId in leads)) extraLeadIds.add(req.leadId)
  for (const group of Object.values(siblingGroups)) {
    if (group.fullPayerLeadId && !(group.fullPayerLeadId in leads)) extraLeadIds.add(group.fullPayerLeadId)
  }
  const extraRoleIds = new Set<string>()
  for (const pair of Object.values(managedPairs)) {
    if (!(pair.roleId in roles)) extraRoleIds.add(pair.roleId)
    if (!(pair.managedRoleId in roles)) extraRoleIds.add(pair.managedRoleId)
  }

  const [extraLeads, extraRoles] = await Promise.all([
    readById<{ id: string; student_name: string; admission_number: string }, { name: string; admissionNumber: string }>(
      supabase,
      "leads",
      "id, student_name, admission_number",
      [...extraLeadIds],
      (r) => ({ name: r.student_name, admissionNumber: r.admission_number }),
    ),
    readById<{ id: string; name: string }, string>(supabase, "roles", "id, name", [...extraRoleIds], (r) => r.name),
  ])

  // A guardian contact linked to exactly one lead resolves straight to that applicant.
  const contactLeadMap = new Map<string, { id: string; name: string; admissionNumber: string }[]>()
  if (!contactLeadsRaw.error) {
    for (const row of (contactLeadsRaw.data ?? []) as {
      id: string
      student_name: string
      admission_number: string
      guardian_contact_id: string
    }[]) {
      const list = contactLeadMap.get(row.guardian_contact_id) ?? []
      list.push({ id: row.id, name: row.student_name, admissionNumber: row.admission_number })
      contactLeadMap.set(row.guardian_contact_id, list)
    }
  }
  const contactLeads: Record<string, { id: string; name: string; admissionNumber: string }> = {}
  for (const [contactId, list] of contactLeadMap) {
    if (list.length === 1) contactLeads[contactId] = list[0]
  }

  const permissions: Record<string, string> = {}
  if (!permissionsResult.error) {
    for (const row of (permissionsResult.data ?? []) as { name: string; label: string }[]) permissions[row.name] = row.label
  }

  const inviteBatches: Record<string, { startedAt: string }> = { ...pageInviteBatches }
  for (const item of batchReports) if (item) inviteBatches[item[0]] = item[1]

  return {
    leads: { ...leads, ...extraLeads },
    contacts,
    contactLeads,
    familyMatchTimeline,
    streams,
    streamRequests,
    agents,
    inviteBatches,
    promoCodes,
    importBatches,
    staff,
    roles: { [SUPER_ADMIN_ROLE_ID]: "Super Admin", ...roles, ...extraRoles },
    permissions,
    managedPairs,
    discountRequests,
    feeSchedules,
    feeBandAmounts,
    classSeats,
    groupLinks,
    siblingGroups,
  }
}
