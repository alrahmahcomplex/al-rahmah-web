import { Note } from "@/components/kit"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getInterviewRegistration, getLeadInterviews, type LeadInterview } from "@/lib/services/interviews"
import type { Lead } from "@/lib/services/leads"
import { createClient } from "@/utils/supabase/server"

import { EarlierInterviews } from "./earlier-interviews"
import { InterviewFeeControl } from "./interview-fee"
import { tzs } from "./interview-outcome"
import { InterviewResultEditor } from "./interview-result"
import { RegisterInterview } from "./register-interview"
import { ResultReleaseSection } from "./result-release-section"

// The lead's interview on the lead screen: its S/N once registered, its fee
// and whether it is paid, its result, score and Next action once recorded.
// Staff who record interviews on an open lead get Register for interview,
// Record result and Correct result; the Accountant gets Mark paid and Mark
// not paid. Everyone who may view the lead sees the panel, with its Result
// release section. After a retaken interview the current one comes first and
// earlier ones below it.
export async function InterviewSection({
  lead,
  canRecord,
  canMarkFee,
}: {
  lead: Lead
  canRecord: boolean
  canMarkFee: boolean
}) {
  const supabase = await createClient()
  const [interviews, registration] = await Promise.all([
    getLeadInterviews(supabase, lead.id),
    // The database says which registration the lead takes: first, retake, or none.
    canRecord ? getInterviewRegistration(supabase, lead.id) : null,
  ])
  const current = interviews.ok ? (interviews.data[0] ?? null) : null
  const kind = registration?.ok ? registration.data : null
  const canRegister = canRecord && interviews.ok && kind !== null

  return (
    <section aria-labelledby="lead-interview" className="lr-card">
      <h2 id="lead-interview" className="kit-card-title">
        Interview
      </h2>
      {!interviews.ok ? (
        <Note tone="bad">The interview could not be loaded. Try again in a moment.</Note>
      ) : current ? (
        <CurrentInterview
          interview={current}
          leadId={lead.id}
          admissionNumber={lead.admissionNumber}
          canRecord={canRecord}
          canMarkFee={canMarkFee}
        />
      ) : (
        !canRegister && <p className="lr-quiet">Not registered for interview.</p>
      )}
      {/* Slice 6: whether the current result can go to the family, and sending it. */}
      {interviews.ok && <ResultReleaseSection leadId={lead.id} />}
      {interviews.ok && <EarlierInterviews interviews={interviews.data.slice(1)} />}
      {canRecord && <RegisterInterview key={lead.id} leadId={lead.id} canRegister={canRegister} retake={kind === "retake"} />}
    </section>
  )
}

function CurrentInterview({
  interview,
  leadId,
  admissionNumber,
  canRecord,
  canMarkFee,
}: {
  interview: LeadInterview
  leadId: string
  admissionNumber: string
  canRecord: boolean
  canMarkFee: boolean
}) {
  const registeredOn = tanzaniaToday(new Date(interview.registeredAt))
  const paid = interview.feeStatus === "Paid"
  return (
    <div role="group" aria-label="Current interview" className="lr-box">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="lr-quiet">Interview S/N</p>
        <p className="lr-num lr-strong text-2xl" aria-label="Interview S/N">
          {interview.serialNumber}
        </p>
        <p className="lr-text">for {interview.enrollmentYear}</p>
      </div>
      <p className="lr-hint">
        The S/N is the place on the {interview.enrollmentYear} interview list. It is not the Admission Number, which
        stays {admissionNumber}.
      </p>
      <dl className="kit-kv">
        <dt>Registered on</dt>
        <dd>{formatDate(registeredOn)}</dd>
        <dt>Interview fee</dt>
        <dd>{interview.feeStatus}</dd>
        {/* Live until the fee is Paid, then the amount locked at that moment. */}
        <dt>{paid ? "Amount paid" : "Amount to pay"}</dt>
        <dd>
          <span>{tzs(interview.amount)}</span>
          {interview.discountApplied && (
            <small>Includes the Referral code discount.</small>
          )}
          {paid && <small>Locked when the fee was marked Paid.</small>}
        </dd>
        {interview.result === null ? (
          <>
            <dt>Result</dt>
            <dd>No result yet</dd>
          </>
        ) : (
          <>
            <dt>Interview date</dt>
            <dd>{interview.interviewDate && formatDate(interview.interviewDate)}</dd>
            <dt>Result</dt>
            <dd>{interview.result}</dd>
            <dt>Score</dt>
            <dd>{interview.score}%</dd>
            <dt>Next action</dt>
            <dd>{interview.nextAction}</dd>
          </>
        )}
      </dl>
      {canMarkFee && (
        // Kept across the refresh after a change, so its confirmation stays.
        <InterviewFeeControl key={interview.id} leadId={leadId} interviewId={interview.id} feeStatus={interview.feeStatus} />
      )}
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
