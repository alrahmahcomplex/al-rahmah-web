import type { Metadata } from "next"

import { ButtonLink, Card, ListRow, Note, PageHeader, pageTitle } from "@/components/kit"

import { formatShillings } from "../fees/format"
import StaffForbidden from "../forbidden"
import StaffNotFound from "../not-found"
import { requireStaff } from "../session"
import { CustodiansCard, type CustodianCardData } from "./custodians-card"
import { familyTitle, parseFamilyIds } from "./model"
import { readFamily, type FamilyStudent } from "./reads"
import { StudentCard } from "./student-card"
import "../applicants/[id]/lead.css"
import "./family.css"

export const metadata: Metadata = {
  title: pageTitle("Family"),
}

const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name

// The Family page (#512, prototype v54, owner 2026-11-21): the students one
// Register students or Check-in save made or completed, with their
// custodians and fees, so staff change any answer on one page. The address
// names the students: /staff/family?students=<lead id>,<lead id>, 2 to 8.
// Each is read with the staff member's own session; one they may not read
// makes the whole page not found. Every change goes through the lead
// record's own action, permission and audit.
export default async function FamilyPage({ searchParams }: { searchParams: Promise<{ students?: string | string[] }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) return <StaffForbidden />

  const ids = parseFamilyIds((await searchParams).students)
  if (!ids) return <StaffNotFound />
  const family = await readFamily(ids, staff.permissions)
  if (family.kind === "not-found") return <StaffNotFound />
  if (family.kind === "unavailable") {
    return (
      <Note tone="bad" role="alert">
        This family could not be loaded. Try again in a moment.
      </Note>
    )
  }

  const { students } = family
  const byId = new Map(students.map((s) => [s.lead.id, s]))
  const mayEdit = staff.permissions.includes("leads.edit")
  const custodians: CustodianCardData[] = family.custodians.map((c) => {
    const members = c.members.map((id) => byId.get(id) as FamilyStudent)
    const { contact } = members[0].lead
    return {
      contactId: c.contactId,
      fullName: contact.fullName,
      phone: contact.phone,
      whatsapp: contact.whatsapp,
      members: members.map((m) => ({
        leadId: m.lead.id,
        firstName: firstWord(m.lead.studentName),
        relationship: m.lead.contact.relationship,
        relationshipDescription: m.lead.contact.relationshipDescription,
      })),
      children: c.children,
    }
  })
  const broughtBy = [...new Set(students.flatMap((s) => (s.broughtBy ? [s.broughtBy] : [])))]
  const fees = students.flatMap((s) => (s.fee ? [{ s, fee: s.fee }] : []))
  const total = fees.reduce((sum, { fee }) => sum + (fee.kind === "fee" ? fee.pays : 0), 0)
  const feesComplete = fees.every(({ fee }) => fee.kind === "fee")

  return (
    <div className="fam-page">
      <ButtonLink href="/staff" variant="ghost" size="small" icon="back" className="fam-back">
        Back
      </ButtonLink>
      <PageHeader
        title={familyTitle(students.map((s) => ({ studentName: s.lead.studentName, fatherFullName: s.father, lastNameFrom: s.lastNameFrom })))}
        subtitle={`${students.length} students from one registration, with their custodians. Change any answer here; each change goes to the Activity log.`}
      />
      <div className="fam-cols">
        <div className="fam-stack">
          {students.map((s) => (
            <StudentCard
              key={s.lead.id}
              student={{
                lead: s.lead,
                father: s.father,
                lastNameFrom: s.lastNameFrom,
                previousSchool: s.previousSchool,
                interview: s.interview,
                compareWith: s.compareWith,
              }}
              canEdit={mayEdit && s.open}
            />
          ))}
        </div>
        <div className="fam-stack">
          <CustodiansCard custodians={custodians} broughtBy={broughtBy} />
          {fees.length > 0 && (
            <Card title="School fees this year" className="fam-side">
              <div>
                {fees.map(({ s, fee }) => (
                  <ListRow
                    key={s.lead.id}
                    title={s.lead.studentName}
                    caption={
                      fee.kind === "fee"
                        ? fee.why
                        : fee.kind === "no-schedule"
                          ? `No fee schedule for ${fee.year} yet`
                          : "The fee could not be loaded"
                    }
                    trailing={fee.kind === "fee" ? <b className="kit-num">{formatShillings(fee.pays)}</b> : undefined}
                  />
                ))}
              </div>
              {feesComplete && (
                <div className="fam-tot">
                  <span>Total</span>
                  <b className="kit-num">{formatShillings(total)}</b>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
