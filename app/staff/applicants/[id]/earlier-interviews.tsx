import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { LeadInterview } from "@/lib/services/interviews"

import { tzs } from "./interview-outcome"

// The lead's earlier interviews, below its current one: after a retaken
// interview (#71), the first sitting with its own S/N, result, score and fee.
// Read-only: the current interview is the one staff work on.
export function EarlierInterviews({ interviews }: { interviews: readonly LeadInterview[] }) {
  if (interviews.length === 0) return null
  return (
    <div role="group" aria-labelledby="earlier-interviews" className="flex flex-col gap-2">
      <h3 id="earlier-interviews" className="lr-sub">
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
      className="lr-box gap-2 text-sm"
    >
      <p className="lr-text">
        <span className="lr-quiet">S/N </span>
        <span className="lr-num font-semibold">{interview.serialNumber}</span>
        <span className="lr-quiet"> for {interview.enrollmentYear}</span>
      </p>
      <dl className="kit-kv">
        <dt>Registered on</dt>
        <dd>{formatDate(tanzaniaToday(new Date(interview.registeredAt)))}</dd>
        {interview.result === null ? (
          <>
            <dt>Result</dt>
            <dd>No result recorded</dd>
          </>
        ) : (
          <>
            <dt>Interview date</dt>
            <dd>{interview.interviewDate && formatDate(interview.interviewDate)}</dd>
            <dt>Result</dt>
            <dd>{interview.result}</dd>
            <dt>Score</dt>
            <dd>{interview.score}%</dd>
          </>
        )}
        <dt>Interview fee</dt>
        <dd>
          {interview.feeStatus}, {tzs(interview.amount)}
          {paid ? " paid" : " to pay"}
          {interview.discountApplied && (
            <small>Includes the Referral code discount.</small>
          )}
        </dd>
      </dl>
    </article>
  )
}
