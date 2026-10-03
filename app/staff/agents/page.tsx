import type { Metadata } from "next"
import Form from "next/form"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { listAgents, type AgentFilter, type AgentList } from "@/lib/services/marketing-agents"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { ApproveAgent } from "./approve-agent"
import { agentsHref, parseAgentSearch, statusParam, type AgentScreenSearch } from "./search-params"

export const metadata: Metadata = {
  title: "Marketing Agents · Al-Rahmah Complex",
}

const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Dar_es_Salaam",
})

const FILTERS: { status: AgentFilter; label: string }[] = [
  { status: "Pending", label: "Pending" },
  { status: "Approved", label: "Approved" },
  { status: "all", label: "All" },
]

const EMPTY: Record<AgentFilter, string> = {
  Pending: "No agents are waiting for approval.",
  Approved: "No agents are Approved yet.",
  all: "No Marketing Agents have registered yet.",
}

// A phone stored as +255700000401 shown as +255 700 000 401.
function displayPhone(phone: string) {
  const match = /^\+255(\d{3})(\d{3})(\d{3})$/.exec(phone)
  return match ? `+255 ${match[1]} ${match[2]} ${match[3]}` : phone
}

export default async function MarketingAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()
  const canApprove = staff.permissions.includes("agents.approve")

  const search = parseAgentSearch(await searchParams, canApprove)
  const results = await listAgents(await createClient(), search)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Marketing Agents</h1>

      <div className="flex flex-col gap-4">
        {/* Keyed on the URL, so the box shows the search the page is showing. */}
        <Form key={agentsHref(search)} action="/staff/agents" role="search" className="flex max-w-xl flex-col gap-1.5">
          <input type="hidden" name="status" value={statusParam(search.status)} />
          <Label htmlFor="agent-search">Search agents</Label>
          <div className="flex gap-2">
            <Input
              id="agent-search"
              name="q"
              type="search"
              defaultValue={search.query ?? ""}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="agent-search-hint"
            />
            <Button type="submit">Search</Button>
          </div>
          <p id="agent-search-hint" className="text-xs text-muted-foreground">
            A name, a code, or a phone number.
          </p>
        </Form>

        <nav aria-label="Agent status" className="flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => {
            const current = filter.status === search.status
            return (
              <Link
                key={filter.status}
                href={agentsHref(search, { status: filter.status, page: 1 })}
                aria-current={current ? "page" : undefined}
                className={buttonVariants({ variant: current ? "default" : "outline", size: "sm" })}
              >
                {filter.label}
              </Link>
            )
          })}
          {search.query && (
            <Link
              href={agentsHref(search, { query: undefined, page: 1 })}
              className="ml-2 text-sm font-medium text-slate-900 underline underline-offset-4"
            >
              Clear search
            </Link>
          )}
        </nav>
      </div>

      {!results.ok ? (
        <Alert variant="destructive">
          <AlertDescription>Marketing Agents could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <Results results={results.data} search={search} canApprove={canApprove} />
      )}
    </div>
  )
}

function Results({ results, search, canApprove }: { results: AgentList; search: AgentScreenSearch; canApprove: boolean }) {
  const { agents, total, page, pageCount } = results
  const empty = search.query ? "No agent matches this search." : EMPTY[search.status]

  return (
    <section aria-label="Results" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? empty : `${total} ${total === 1 ? "agent" : "agents"}`}
      </p>

      {agents.length > 0 && (
        <div className="overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          <table aria-label="Marketing Agents" className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Phone</th>
                <th scope="col" className="px-3 py-2 font-medium">Code</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Registered</th>
                <th scope="col" className="px-3 py-2 font-medium">Approved</th>
                {canApprove && (
                  <th scope="col" className="px-3 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} className="border-b align-top last:border-b-0 hover:bg-slate-50">
                  <th scope="row" className="px-3 py-2 font-medium text-slate-900">
                    {agent.fullName}
                  </th>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <a href={`tel:${agent.phone}`} className="underline-offset-4 hover:underline">
                      {displayPhone(agent.phone)}
                    </a>
                    {agent.whatsapp && (
                      <p className="text-xs text-muted-foreground">WhatsApp {displayPhone(agent.whatsapp)}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{agent.code}</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={agent.status === "Approved" ? "secondary" : "outline"}
                      className={cn(agent.status === "Approved" && "bg-emerald-50 text-emerald-800")}
                    >
                      {agent.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <time dateTime={agent.registeredAt}>{WHEN.format(new Date(agent.registeredAt))}</time>
                  </td>
                  <td className="px-3 py-2">
                    {agent.approvedAt ? (
                      <>
                        <p>{agent.approvedBy ?? "Unknown"}</p>
                        <time dateTime={agent.approvedAt} className="text-xs whitespace-nowrap text-muted-foreground">
                          {WHEN.format(new Date(agent.approvedAt))}
                        </time>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not yet</span>
                    )}
                  </td>
                  {canApprove && (
                    <td className="px-3 py-2">
                      {agent.status === "Pending" && (
                        <ApproveAgent agent={{ id: agent.id, fullName: agent.fullName, code: agent.code }} />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-3">
          {page > 1 ? (
            <Link href={agentsHref(search, { page: page - 1 })} className={buttonVariants({ variant: "outline" })}>
              Previous
            </Link>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </p>
          {page < pageCount ? (
            <Link href={agentsHref(search, { page: page + 1 })} className={buttonVariants({ variant: "outline" })}>
              Next
            </Link>
          ) : null}
        </nav>
      )}
    </section>
  )
}
