import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { Card, KeyValueList, PageHeader, StepTrack, pageTitle, type StepTrackItem } from "@/components/kit"
import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { getAgentStudent } from "@/lib/services/agent-students"
import { createClient } from "@/utils/supabase/server"

import { AGENTS_COPY, firstName, formatTanzaniaDate, PROGRESS_STEPS, STUDENTS_COPY } from "../../copy"
import { StudentReminderActions } from "./reminder-actions"

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id }, language, supabase] = await Promise.all([params, getLanguage(), createClient()])
  const result = await getAgentStudent(supabase, id)
  if (result.ok && result.data.kind === "active" && result.data.student) {
    return { title: pageTitle(result.data.student.name) }
  }
  return { title: pageTitle(AGENTS_COPY[language].navStudents) }
}

export default async function AgentStudentDetailPage({ params }: Props) {
  const [{ id }, language, supabase] = await Promise.all([params, getLanguage(), createClient()])
  const result = await getAgentStudent(supabase, id)

  if (!result.ok && result.error === "not-agent") redirect("/auth?from=home")
  if (!result.ok || result.data.kind !== "active") redirect("/home")

  const student = result.data.student
  if (!student) notFound()

  const copy = AGENTS_COPY[language]
  const studentsCopy = STUDENTS_COPY[language]

  const isDeclined = student.status === "Declined"
  const currentIndex = PROGRESS_STEPS.indexOf(student.status)
  const stepItems: StepTrackItem[] = PROGRESS_STEPS.map((status, index) => ({
    key: status,
    label: studentsCopy.statuses[status],
    state:
      student.status === "Enrolled" || index < currentIndex
        ? "done"
        : index === currentIndex
          ? "current"
          : "upcoming",
  }))

  const interviewText = student.result
    ? copy.resultValue(student.result.outcome, student.result.score)
    : student.interviewRegistered
      ? studentsCopy.resultPending
      : "—"

  const declinedWhy = student.declinedReason
    ? (studentsCopy.declinedReasons[student.declinedReason] ?? student.declinedReason)
    : null

  const reminderMessage = student.reminder
    ? studentsCopy.reminder[student.reminder.step](firstName(student.name), OFFICE_PHONE)
    : null

  return (
    <>
      <PageHeader title={student.name} />
      <div className={student.reminder ? "ag-cols" : "ag-cols ag-cols-single"}>
        <Card title={copy.stepNow}>
          {isDeclined ? (
            <>
              <p className="ag-declined-title">{studentsCopy.statuses.Declined}</p>
              {declinedWhy && <p className="ag-declined-why">{declinedWhy}</p>}
            </>
          ) : (
            <div className="ag-step-wrap">
              <StepTrack label={copy.stepNow} steps={stepItems} />
            </div>
          )}

          <div className="ag-kv-sep">
            <KeyValueList
              items={[
                { key: copy.classLabel, value: student.className },
                { key: copy.interviewLabel, value: interviewText },
                { key: copy.changedLabel, value: formatTanzaniaDate(student.lastChange, language) },
              ]}
            />
          </div>
        </Card>

        {student.reminder && reminderMessage && (
          <Card title={copy.remindLine[student.reminder.step]}>
            <p className="ag-msg">{reminderMessage}</p>
            <StudentReminderActions language={language} message={reminderMessage} />
          </Card>
        )}
      </div>
    </>
  )
}
