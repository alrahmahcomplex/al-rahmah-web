import Link from "next/link"

import { Card, EmptyState, ListRow, Note, StatusChip } from "@/components/kit"
import type { LatestLead } from "@/lib/services/today"
import type { Result } from "@/lib/services/result"

import { initials } from "./greeting"

// The newest leads, each opening the student's screen.
export function LatestRegistrations({ leads }: { leads: Result<LatestLead[], "unavailable"> }) {
  return (
    <Card title="Latest registrations" titleId="latest-heading">
      {!leads.ok ? (
        <Note tone="bad" className="td-gap">
          The latest registrations could not be loaded. Try again in a moment.
        </Note>
      ) : leads.data.length === 0 ? (
        <EmptyState title="No students registered yet." />
      ) : (
        <ul className="td-rows">
          {leads.data.map((lead) => (
            <li key={lead.id}>
              <ListRow
                href={`/staff/applicants/${lead.id}`}
                leading={
                  <span aria-hidden="true" className="kit-row-disc td-initials">
                    {initials(lead.studentName)}
                  </span>
                }
                title={lead.studentName}
                caption={
                  <>
                    <span className="kit-num">{lead.admissionNumber}</span>
                    {" · "}
                    {lead.className}
                  </>
                }
                trailing={
                  <span className="td-chips">
                    <StatusChip status={lead.status} />
                    {lead.closure && <StatusChip status={lead.closure} />}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <p className="td-more">
        <Link href="/staff/applicants" className="kit-link">
          All applicants
        </Link>
      </p>
    </Card>
  )
}
