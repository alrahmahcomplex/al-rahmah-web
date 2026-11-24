import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Card, ListRow, Note, PageHeader, pageTitle } from "@/components/kit"
import { getLanguage } from "@/lib/language"
import { getAgentStudents } from "@/lib/services/agent-students"
import { createClient } from "@/utils/supabase/server"

import { AGENTS_COPY, STUDENTS_COPY } from "../copy"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return { title: pageTitle(AGENTS_COPY[language].remindPage) }
}

export default async function AgentsRemindersPage() {
  const [language, supabase] = await Promise.all([getLanguage(), createClient()])
  const list = await getAgentStudents(supabase, { search: "", limit: 1, offset: 0 })

  if (!list.ok && list.error === "not-agent") redirect("/auth?from=home")
  if (!list.ok || list.data.kind !== "active") redirect("/home")

  const { reminders } = list.data
  const copy = AGENTS_COPY[language]
  const studentsCopy = STUDENTS_COPY[language]

  return (
    <>
      <PageHeader title={studentsCopy.remindHeading(reminders.length)} />
      {reminders.length === 0 ? (
        <Note>{studentsCopy.emptyNote}</Note>
      ) : (
        <Card className="ag-list-card">
          {reminders.map((item) => (
            <ListRow
              key={item.id}
              inset
              icon="followups"
              title={
                <>
                  {item.name} <span className="ag-row-cls">· {item.className}</span>
                </>
              }
              caption={copy.remindLine[item.step]}
              href={`/students/${item.id}`}
            />
          ))}
        </Card>
      )}
    </>
  )
}
