import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { LeadInterview } from "@/lib/services/interviews"

import { tzs } from "./interview-outcome"

// The lead's earlier interviews, below its current one: after a retaken
// interview (#71), the first sitting with its own S/N, result, score and fee.
// Read-only: the current interview is the one staff work on.
export function EarlierInterviews({ interviews }: { interviews: readonly LeadInterview[] }) {
  if (interviews.length === 0) return null
  return (
    <div role="group" aria-labelledby="earlier-interviews" className="flex max-w-xl flex-col gap-2">
      <h3 id="earlier-interviews" className="text-sm font-medium text-muted-foreground">
        Earlier {interviews.length === 1 ? "interview" : "interviews"}
      </h3>
      <ul className="flex flex-col gap-2">
        {interviews.map((interview) => (
          <li key={interview.id}>
            <EarlierInterview interview={interview} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function EarlierInterview({ interview }: { interview: LeadInterview }) {
  const paid = interview.feeStatus === "Paid"
  return (
    <article
      aria-label={`S/N ${interview.serialNumber}, earlier interview`}
      className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3 text-sm ring-1 ring-foreground/10"
    >
      <p className="text-slate-900">
        <span className="text-muted-foreground">S/N </span>
        <span className="font-mono font-semibold">{interview.serialNumber}</span>
        <span className="text-muted-foreground"> for {interview.enrollmentYear}</span>
      </p>
      <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Registered on</dt>
        <dd className="text-slate-900">{formatDate(tanzaniaToday(new Date(interview.registeredAt)))}</dd>
        {interview.result === null ? (
          <>
            <dt className="text-muted-foreground">Result</dt>
            <dd className="text-slate-900">No result recorded</dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">Interview date</dt>
            <dd className="text-slate-900">{interview.interviewDate && formatDate(interview.interviewDate)}</dd>
            <dt className="text-muted-foreground">Result</dt>
            <dd className="font-medium text-slate-900">{interview.result}</dd>
            <dt className="text-muted-foreground">Score</dt>
            <dd className="text-slate-900">{interview.score}%</dd>
          </>
        )}
        <dt className="text-muted-foreground">Interview fee</dt>
        <dd className="text-slate-900">
          {interview.feeStatus}, {tzs(interview.amount)}
          {paid ? " paid" : " to pay"}
          {interview.discountApplied && (
            <span className="block text-xs text-muted-foreground">Includes the Referral code discount.</span>
          )}
        </dd>
      </dl>
    </article>
  )
}
