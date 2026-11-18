import type { SupabaseClient } from "@supabase/supabase-js"

import { Card, ListRow, Note } from "@/components/kit"
import type { Permission } from "@/lib/permissions"
import { tanzaniaToday } from "@/lib/school-calendar"
import type { SiblingFollowUp } from "@/lib/services/leads"
import { getSiblingFeeCounts, getSiblingLeadCounts, getSiblingRequestCounts, type StaffCount } from "@/lib/services/sibling-counts"
import { FEE_EDIT_REASONS } from "@/lib/sibling-sentences"

import { FEE_EDIT_REASON_ORDER } from "../applicants/[id]/fee-edit-outcome"
import { leadsHref } from "../applicants/search-params"

// "Sibling discount follow-up" on Reports (#311, B10): the stuck or unusual
// Sibling cases, each behind the permission that already guards what it
// counts (#306). Admissions Staff see the desk counts, the Admissions
// Manager adds the requests, staff who may view payments add the fee
// counts. A row with a list opens Applicants showing exactly the leads it
// counts (leads_for_sibling_follow_up).

type Row = { title: string; caption: string; count: number; href?: string }

const followUpHref = (kind: SiblingFollowUp) => leadsHref({ siblingFollowUp: kind, closure: "open", page: 1 })

// "Example Staff One 2 · Example Staff Two 1".
const byStaff = (rows: readonly { name: string; count: number }[]) => rows.map((r) => `${r.name} ${r.count}`).join(" · ")
const named = (rows: readonly StaffCount[]) => rows.map((r) => ({ name: r.staffName ?? "System", count: r.count }))

export async function SiblingFollowUp({ supabase, permissions }: { supabase: SupabaseClient; permissions: readonly Permission[] }) {
  const canApprove = permissions.includes("discounts.approve")
  const canSeeFees = permissions.includes("payments.view")
  const [leads, requests, fees] = await Promise.all([
    getSiblingLeadCounts(supabase),
    canApprove ? getSiblingRequestCounts(supabase) : null,
    canSeeFees ? getSiblingFeeCounts(supabase) : null,
  ])
  const failed = !leads.ok || (requests && !requests.ok) || (fees && !fees.ok)

  const rows: Row[] = []
  if (requests?.ok) {
    const waiting = requests.data.pending
    const oldest = Math.max(0, ...waiting.requests.map((r) => r.daysWaiting))
    rows.push({
      title: "Sibling requests waiting",
      caption:
        waiting.count === 0
          ? "None waiting"
          : oldest === 0
            ? "The oldest was sent today"
            : `The oldest has waited ${oldest} ${oldest === 1 ? "day" : "days"}`,
      count: waiting.count,
      href: "/staff/discounts",
    })
  }
  if (leads.ok) {
    // Typing mistakes confirmed this month, Tanzania time, by who confirmed them.
    const month = tanzaniaToday().slice(0, 7)
    const names = new Map(leads.data.typoConfirmed.byStaff.map((s) => [s.staffId, s.staffName ?? "System"]))
    const thisMonth = leads.data.typoConfirmed.members.filter((m) => m.confirmedAt && tanzaniaToday(new Date(m.confirmedAt)).startsWith(month))
    const counted = new Map<string, number>()
    for (const m of thisMonth) {
      const name = names.get(m.staffId) ?? "System"
      counted.set(name, (counted.get(name) ?? 0) + 1)
    }
    rows.push({
      title: "Typing mistakes confirmed at the desk",
      caption: thisMonth.length ? `This month: ${byStaff([...counted].map(([name, count]) => ({ name, count })))}` : "None this month",
      count: thisMonth.length,
    })
    const school = leads.data.previousSchool
    rows.push({
      title: "Previous school not known yet",
      caption: "STD 2 and above · add it on the student’s record",
      count: school.notKnown,
      href: followUpHref("not_known"),
    })
    if (school.missing > 0) {
      rows.push({ title: "Previous school missing", caption: "STD 2 and above", count: school.missing, href: followUpHref("missing") })
    }
  }
  if (fees?.ok) {
    const edits = fees.data.feeEdits
    const reasons = FEE_EDIT_REASON_ORDER.filter((r) => (edits.byReason[r] ?? 0) > 0).map((r) => `${FEE_EDIT_REASONS[r].en} ${edits.byReason[r]}`)
    rows.push(
      {
        title: "Fees edited by hand",
        caption: edits.count ? [...reasons, byStaff(named(edits.byStaff))].join(" · ") : "None",
        count: edits.count,
      },
      {
        title: "Kept the 10% when leaving the old family rule",
        caption: "Families from before this change, after staff confirmed a father’s name",
        count: fees.data.keptTen.count,
        href: followUpHref("kept_ten"),
      },
      {
        title: "Enrolled at 10%, no sibling Enrolled at full",
        caption: "Reset to the full fee if the sibling never enrolls",
        count: fees.data.enrolledTenNoFull.count,
        href: followUpHref("no_full"),
      },
      {
        title: "Granted: fee edit needed",
        caption: "Apply the 10%, or leave the fee with a reason",
        // Students, not requests: two grants for one student before the fee
        // decision is one row in the list it opens.
        count: new Set(fees.data.feeEditNeeded.requests.map((r) => r.leadId)).size,
        href: followUpHref("fee_edit_needed"),
      },
    )
  }

  return (
    <Card title="Sibling discount follow-up" caption="Stuck or unusual cases, so nothing is forgotten." className="rp-sib">
      {failed && (
        <Note tone="bad" role="alert">
          Some of these counts could not be loaded. Try again in a moment.
        </Note>
      )}
      <div className="rp-sib-rows">
        {rows.map((row) => (
          <ListRow
            key={row.title}
            title={row.title}
            caption={row.caption}
            href={row.href}
            trailing={<b className="rp-sib-n kit-num">{row.count.toLocaleString("en-GB")}</b>}
          />
        ))}
      </div>
    </Card>
  )
}
