import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { listAgentImports } from "@/lib/services/agent-import"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { AgentImport } from "./agent-import"

export const metadata: Metadata = {
  title: "Import agents · Al-Rahmah Complex",
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/staff/agents" className="text-sm font-medium text-slate-700 underline underline-offset-4">
          Marketing Agents
        </Link>
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Import agents</h1>
        <p className="max-w-2xl text-sm text-slate-700">
          Add existing agents from a spreadsheet, keeping their codes. Imported agents start Approved. The import sends no email.
        </p>
      </div>

      <AgentImport />

      {imports.ok && imports.data.length > 0 && (
        <section aria-labelledby="earlier-heading" className="flex max-w-2xl flex-col gap-2">
          <h2 id="earlier-heading" className="text-lg font-semibold text-slate-900">
            Earlier imports
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {imports.data.map((batch) => (
              <li key={batch.id} className="wrap-anywhere">
                <Link href={`/staff/agents?status=all&import=${batch.id}`} className="font-medium underline underline-offset-4">
                  {batch.fileName}
                </Link>{" "}
                <span className="text-muted-foreground">
                  <time dateTime={batch.importedAt}>{WHEN.format(new Date(batch.importedAt))}</time>
                  {batch.importedBy ? ` by ${batch.importedBy}` : ""}: {batch.createdCount} created,{" "}
                  {batch.updatedCount === 1 ? "1 email" : `${batch.updatedCount} emails`} added, {batch.skippedCount} skipped
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
