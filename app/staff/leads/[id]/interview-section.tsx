import { Alert, AlertDescription } from "@/components/ui/alert"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadInterviews, type LeadInterview } from "@/lib/services/interviews"
import type { Lead } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { InterviewResultEditor } from "./interview-result"
import { RegisterInterview } from "./register-interview"

// The lead's interview on the lead screen: its S/N once registered, its
// result, score and Next action once recorded, and, for staff who record
// interviews on an open lead, Register for interview, Record result and
// Correct result. Everyone who may view the lead sees the panel.
export async function InterviewSection({ lead, canRecord }: { lead: Lead; canRecord: boolean }) {
  const interviews = await getLeadInterviews(await createClient(), lead.id)
  const current = interviews.ok ? (interviews.data[0] ?? null) : null
  const canRegister =
    canRecord && interviews.ok && current === null && (lead.status === "Applied" || lead.status === "Visited")

  return (
    <section aria-labelledby="lead-interview" className="flex flex-col gap-3">
      <h2 id="lead-interview" className="text-sm font-semibold text-slate-900">
        Interview
      </h2>
      {!interviews.ok ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription>The interview could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : current ? (
        <CurrentInterview interview={current} leadId={lead.id} admissionNumber={lead.admissionNumber} canRecord={canRecord} />
      ) : (
        !canRegister && <p className="text-sm text-muted-foreground">Not registered for interview.</p>
      )}
      {canRecord && <RegisterInterview key={lead.id} leadId={lead.id} canRegister={canRegister} />}
    </section>
  )
}

function CurrentInterview({
  interview,
  leadId,
  admissionNumber,
  canRecord,
}: {
  interview: LeadInterview
  leadId: string
  admissionNumber: string
  canRecord: boolean
}) {
  const registeredOn = tanzaniaToday(new Date(interview.registeredAt))
  return (
    <div className="flex max-w-xl flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm text-muted-foreground">Interview S/N</p>
        <p className="font-mono text-2xl font-semibold text-slate-900" aria-label="Interview S/N">
          {interview.serialNumber}
        </p>
        <p className="text-sm text-slate-900">for {interview.enrollmentYear}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        The S/N is the place on the {interview.enrollmentYear} interview list. It is not the Admission Number, which
        stays {admissionNumber}.
      </p>
      <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Registered on</dt>
        <dd className="text-slate-900">{formatDate(registeredOn)}</dd>
        {interview.result === null ? (
          <>
            <dt className="text-muted-foreground">Result</dt>
            <dd className="text-slate-900">No result yet</dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">Interview date</dt>
            <dd className="text-slate-900">{interview.interviewDate && formatDate(interview.interviewDate)}</dd>
            <dt className="text-muted-foreground">Result</dt>
            <dd className="font-medium text-slate-900">{interview.result}</dd>
            <dt className="text-muted-foreground">Score</dt>
            <dd className="text-slate-900">{interview.score}%</dd>
            <dt className="text-muted-foreground">Next action</dt>
            <dd className="text-slate-900">{interview.nextAction}</dd>
          </>
        )}
      </dl>
      {canRecord && (
        <InterviewResultEditor
          // Kept across the refresh after a save, so its confirmation stays.
          // The form reads the recorded values afresh each time it opens.
          key={interview.id}
          leadId={leadId}
          interview={{
            id: interview.id,
            registeredOn,
            interviewDate: interview.interviewDate,
            result: interview.result,
            score: interview.score,
          }}
        />
      )}
    </div>
  )
}
