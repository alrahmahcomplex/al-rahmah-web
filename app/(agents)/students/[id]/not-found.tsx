import { ButtonLink, Card, EmptyState } from "@/components/kit"
import { getLanguage } from "@/lib/language"

import { AGENTS_COPY } from "../../copy"

export default async function AgentStudentNotFound() {
  const language = await getLanguage()
  const copy = AGENTS_COPY[language]

  return (
    <div className="ag-narrow">
      <Card>
        <EmptyState
          title={copy.notFoundTitle}
          hint={copy.notFoundHint}
          action={
            <ButtonLink href="/students" variant="ghost" size="small">
              {copy.backToStudents}
            </ButtonLink>
          }
        />
      </Card>
    </div>
  )
}
