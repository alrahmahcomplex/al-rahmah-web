import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import type { LatestLead } from "@/lib/services/today"
import type { Result } from "@/lib/services/result"

import { initials } from "./greeting"

// The newest leads, each opening the student's screen.
export function LatestRegistrations({ leads }: { leads: Result<LatestLead[], "unavailable"> }) {
  return (
    <section aria-labelledby="latest-heading" className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="latest-heading" className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
          Latest registrations
        </h2>
        <Link href="/staff/leads" className="text-xs font-medium text-blue-600 underline-offset-4 hover:underline">
          All leads
        </Link>
      </div>
      {!leads.ok ? (
        <p className="rounded-xl bg-card px-4 py-3 text-sm text-muted-foreground ring-1 ring-foreground/10">
          The latest registrations could not be loaded. Try again in a moment.
        </p>
      ) : leads.data.length === 0 ? (
        <p className="rounded-xl bg-card px-4 py-3 text-sm text-slate-600 ring-1 ring-foreground/10">No students registered yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {leads.data.map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/staff/leads/${lead.id}`}
                className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-slate-50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600"
                >
                  {initials(lead.studentName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{lead.studentName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <span className="font-mono">{lead.admissionNumber}</span>
                    {" · "}
                    {lead.className}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  <Badge variant={lead.status === "Declined" ? "destructive" : "secondary"}>{lead.status}</Badge>
                  {lead.closure && <Badge variant="outline">{lead.closure}</Badge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
