import { Tag } from "@/components/kit"
import type { InterviewResult } from "@/lib/services/interviews"

// An interview result as a tag, the same on the Interviews list and the
// applicant's record (prototype v7): Passed green, Conditional orange, Failed
// red.
const TONE = { Passed: "ok", Conditional: "wait", Failed: "bad" } as const satisfies Record<InterviewResult, string>

export function ResultTag({ result }: { result: InterviewResult }) {
  return <Tag tone={TONE[result]}>{result}</Tag>
}
