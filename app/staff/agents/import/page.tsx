import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Card, PageHeader, pageTitle } from "@/components/kit"
import { listAgentImports } from "@/lib/services/agent-import"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { AgentImport } from "./agent-import"
import "../agents.css"

export const metadata: Metadata = {
  title: pageTitle("Import agents"),
}

const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

// The Manager's agent import (#190): template, upload, check, confirm and
// the refused rows. Earlier imports link to the agents each created.
export default async function AgentImportPage() {
  const staff = await requireStaff()
  if (!staff.permissions.includes("agents.approve")) forbidden()
  const imports = await listAgentImports(await createClient(), 10)

  return (
    <div className="ag-page">
      <div className="ag-stack">
        <Link href="/staff/agents" className="ag-link ag-back">
          Marketing Agents
        </Link>
        <PageHeader
          title="Import agents"
          subtitle="Add existing agents from a spreadsheet, keeping their codes. Imported agents start Approved. The import sends no email."
        />
      </div>

      <AgentImport />

      {imports.ok && imports.data.length > 0 && (
        <Card title="Earlier imports">
          <ul className="ag-earlier ag-card-body">
            {imports.data.map((batch) => (
              <li key={batch.id} className="ag-wrap">
                <Link href={`/staff/agents?status=all&import=${batch.id}`} className="ag-link">
                  {batch.fileName}
                </Link>{" "}
                <span className="ag-quiet">
                  <time dateTime={batch.importedAt}>{WHEN.format(new Date(batch.importedAt))}</time>
                  {batch.importedBy ? ` by ${batch.importedBy}` : ""}: {batch.createdCount} created,{" "}
                  {batch.updatedCount === 1 ? "1 email" : `${batch.updatedCount} emails`} added, {batch.skippedCount} skipped
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
