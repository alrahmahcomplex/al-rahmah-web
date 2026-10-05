import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { getLeadHistory } from "@/lib/services/audit"
import { getLeadFollowUps } from "@/lib/services/follow-ups"
import { getLead } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../../session"
import { describeLeadHistory, type DescribedEntry } from "./describe"

export const metadata: Metadata = {
  title: "Lead history · Al-Rahmah Complex",
}

// The school is in Tanzania, so times read in East Africa Time whatever the
// server's own zone is.
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// Every change to a lead and to the parent or guardian it is or was linked
// to, newest first: who made it, when, and each field's old and new value.
export default async function LeadHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const { id } = await params
  const supabase = await createClient()
  const [lead, history, followUps] = await Promise.all([getLead(supabase, id), getLeadHistory(supabase, id), getLeadFollowUps(supabase, id)])
  if (!lead.ok && lead.error === "not-found") notFound()
  // Who made each recorded contact, by name alongside the contacts' names.
  const contactedBy = Object.fromEntries(
    (followUps.ok ? followUps.data.records : []).flatMap((record) =>
      record.contactedBy?.name ? [[record.contactedBy.id, record.contactedBy.name]] : [],
    ),
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">History</h1>
        {lead.ok && (
          <p className="text-sm text-slate-900">
            {lead.data.studentName} · <span className="font-mono font-semibold">{lead.data.admissionNumber}</span>
          </p>
        )}
      </div>

      {!lead.ok || !history.ok ? (
        <Alert variant="destructive">
          <AlertDescription>This lead&apos;s history could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <>
          {!followUps.ok && (
            <Alert>
              <AlertDescription>
                The names of staff who made contacts could not be loaded, so some contact entries show an id. Reload to try again.
              </AlertDescription>
            </Alert>
          )}
          <Entries entries={describeLeadHistory(history.data.entries, { ...contactedBy, ...history.data.contactNames })} />
        </>
      )}

      <div>
        <Link href={`/staff/leads/${id}`} className={buttonVariants({ variant: "outline" })}>
          Back to the lead
        </Link>
      </div>
    </div>
  )
}

function Entries({ entries }: { entries: DescribedEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No changes yet.</p>

  return (
    <ol aria-label="History" className="flex max-w-2xl flex-col divide-y text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-1 py-3">
          <p>
            <span className="font-medium">{entry.actor}</span> {entry.summary}
            <time dateTime={entry.at} className="block text-xs text-muted-foreground sm:ml-2 sm:inline">
              {WHEN.format(new Date(entry.at))}
            </time>
          </p>
          {entry.changes.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {entry.changes.map((change) => (
                <li key={change.label} className="break-words">
                  {change.label}: {change.from !== null && <>{change.from} → </>}
                  <span className="text-foreground">{change.to}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
