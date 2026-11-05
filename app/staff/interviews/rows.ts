import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { InterviewListItem } from "@/lib/services/interview-list"
import type { ReleaseStatus } from "@/lib/services/result-release"

export type InterviewRow = InterviewListItem & {
  // When the result on show was last sent, as a date in Tanzania; null when
  // never sent, or changed since, which counts as not sent.
  sentOn: string | null
}

// The list is read before the release status, and a result can be corrected
// and sent in between. Each row takes its result and score from the status
// read, so they are the ones its sent date was judged against. An interview
// the status read did not find keeps the list's values and claims no send.
export function interviewRows(
  interviews: readonly InterviewListItem[],
  statuses: ReadonlyMap<string, ReleaseStatus>,
): InterviewRow[] {
  return interviews.map((interview) => {
    const status = statuses.get(interview.id)
    if (!status) return { ...interview, sentOn: null }
    const sent = status.lastReleasedAt !== null && !status.changedSinceSent
    return {
      ...interview,
      result: status.result,
      score: status.score,
      sentOn: sent ? formatDate(tanzaniaToday(new Date(status.lastReleasedAt!))) : null,
    }
  })
}
