import type { Metadata } from "next"
import Form from "next/form"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getAgentAccess } from "@/lib/services/agent-access"
import { listAgentsInAccountState } from "@/lib/services/agent-account-list"
import { getAgentImport } from "@/lib/services/agent-import"
import {
  getAgentAccountCounts,
  getAgentInvites,
  reconcileAgentEmails,
  type AgentInviteNote,
} from "@/lib/services/agent-invites"
import { getPendingAgentCount, listAgents, type AgentFilter, type AgentList } from "@/lib/services/marketing-agents"
import { cn } from "@/lib/utils"
import { agentLogins } from "@/utils/supabase/admin"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { AgentAccessBanner } from "./access-banner"
import { AccountStateBadge, AgentInviteActions } from "./agent-invite"
import { AgentStatusActions } from "./agent-status-actions"
import { ApproveAgent } from "./approve-agent"
import { CreateAgent } from "./create-agent"
import { inviteLine, needsAttention } from "./invite-outcome"
import { RecreateAgent } from "./recreate-agent"
import { statusChangeLine } from "./outcome"
import { accountParam, agentsHref, parseAgentSearch, statusParam, type AgentScreenSearch } from "./search-params"

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
  // Retired records show only here.
  { status: "Retired", label: "Retired" },
]

// The account-state filters (#191), each with its count.
const ACCOUNT_FILTERS = [
  { account: "invite_not_sent", label: "Invite not sent" },
  { account: "invite_expired", label: "Invited, link expired" },
] as const

const EMPTY: Record<AgentFilter, string> = {
  Pending: "No agents are waiting for approval.",
  Approved: "No agents are Approved yet.",
  Retired: "No agents are retired.",
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
  const supabase = await createClient()
  // A joined agent's email change that stopped part way, or whose sign-in
  // email changed late, is put in line before the emails are read. A failure
  // is logged and the screen shows what is stored.
  await reconcileAgentEmails(agentLogins())
  const [results, batch, access, counts, pendingCount] = await Promise.all([
    search.account
      ? listAgentsInAccountState(supabase, search.account, {
          query: search.query,
          page: search.page,
          importBatchId: search.importBatchId,
        })
      : listAgents(supabase, search),
    search.importBatchId ? getAgentImport(supabase, search.importBatchId) : null,
    getAgentAccess(supabase),
    getAgentAccountCounts(supabase),
    canApprove ? getPendingAgentCount(supabase) : null,
  ])
  // The invite badge and line for each agent on this page.
  const invites = results.ok ? await getAgentInvites(supabase, results.data.agents.map((agent) => agent.id)) : null
  const attention = counts.ok ? needsAttention(counts.data) : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Marketing Agents</h1>
        {canApprove && (
          <div className="flex flex-wrap gap-2">
            <Link href="/staff/agents/import" className={buttonVariants({ variant: "outline" })}>
              Import from CSV
            </Link>
            <CreateAgent />
          </div>
        )}
      </div>

      <AgentAccessBanner access={access} />

      <div className="flex flex-col gap-4">
        {/* Keyed on the URL, so the box shows the search the page is showing. */}
        <Form key={agentsHref(search)} action="/staff/agents" role="search" className="flex max-w-xl flex-col gap-1.5">
          <input type="hidden" name="status" value={statusParam(search.status)} />
          {search.account && <input type="hidden" name="account" value={accountParam(search.account)} />}
          {search.importBatchId && <input type="hidden" name="import" value={search.importBatchId} />}
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
            const current = !search.account && filter.status === search.status
            return (
              <Link
                key={filter.status}
                href={agentsHref(search, { status: filter.status, account: undefined, page: 1 })}
                aria-current={current ? "page" : undefined}
                className={buttonVariants({ variant: current ? "default" : "outline", size: "sm" })}
              >
                {filter.label}
              </Link>
            )
          })}
          {counts.ok &&
            ACCOUNT_FILTERS.map((filter) => {
              const current = search.account === filter.account
              return (
                <Link
                  key={filter.account}
                  href={agentsHref(search, { account: filter.account, page: 1 })}
                  aria-current={current ? "page" : undefined}
                  className={buttonVariants({ variant: current ? "default" : "outline", size: "sm" })}
                >
                  {filter.label}
                  <span className="tabular-nums">&nbsp;({counts.data[filter.account]})</span>
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
        {attention && (
          <NeedsAttention attention={attention} pending={pendingCount?.ok ? pendingCount.data : null} />
        )}
      </div>

      {search.importBatchId && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <p className="min-w-0 wrap-anywhere">
            {batch?.ok && batch.data ? (
              <>
                Agents created by the import of <span className="font-medium">{batch.data.fileName}</span> on{" "}
                <time dateTime={batch.data.importedAt}>{WHEN.format(new Date(batch.data.importedAt))}</time>
                {batch.data.importedBy ? ` by ${batch.data.importedBy}` : ""}
              </>
            ) : (
              "Agents created by an import that can't be found"
            )}
          </p>
          <Link
            href={agentsHref(search, { importBatchId: undefined, page: 1 })}
            className="font-medium text-slate-900 underline underline-offset-4"
          >
            Show every agent
          </Link>
        </div>
      )}

      {invites && !invites.ok && (
        <Alert variant="destructive">
          <AlertDescription>
            The agents&apos; emails and invites could not be loaded, so Approve, Send invite and Edit email are off.
            Reload the page in a moment.
          </AlertDescription>
        </Alert>
      )}

      {!results.ok ? (
        <Alert variant="destructive">
          <AlertDescription>Marketing Agents could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <Results
          results={results.data}
          search={search}
          canApprove={canApprove}
          invites={invites?.ok ? invites.data : null}
        />
      )}
    </div>
  )
}

// "Needs attention" beside the Pending count, for approvers: the sum of the
// named counts, with the breakdown.
function NeedsAttention({ attention, pending }: { attention: ReturnType<typeof needsAttention>; pending: number | null }) {
  return (
    <p className="text-sm">
      {pending !== null && <span className="font-medium">Pending: {pending} · </span>}
      <span className="font-medium">Needs attention: {attention.total}</span>
      <span className="text-muted-foreground">
        {" "}
        ({attention.parts.map((part) => part.count + " " + part.label).join(", ")})
      </span>
    </p>
  )
}

const ACCOUNT_EMPTY: Record<NonNullable<AgentScreenSearch["account"]>, string> = {
  invite_not_sent: "Every Approved agent with an email has been sent an invite.",
  invite_expired: "No agent's invite link has expired.",
}

function Results({
  results,
  search,
  canApprove,
  invites,
}: {
  results: AgentList
  search: AgentScreenSearch
  canApprove: boolean
  // Null when they couldn't be read: the actions that use the email are off.
  invites: Map<string, AgentInviteNote> | null
}) {
  const { agents, total, page, pageCount } = results
  const empty = search.query
    ? "No agent matches this search."
    : search.account
      ? ACCOUNT_EMPTY[search.account]
      : EMPTY[search.status]

  return (
    <section aria-label="Results" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? empty : `${total} ${total === 1 ? "agent" : "agents"}`}
      </p>

      {agents.length > 0 && (
        <div className="relative overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          {/* Relative, so the table's screen-reader-only text scrolls with it
              instead of widening the page on a phone. */}
          <table aria-label="Marketing Agents" className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Phone</th>
                <th scope="col" className="px-3 py-2 font-medium">Code</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Registered</th>
                <th scope="col" className="px-3 py-2 font-medium">Approved</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Leads</th>
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
                    {invites?.get(agent.id)?.email && (
                      <p className="max-w-56 text-xs whitespace-normal wrap-anywhere text-muted-foreground">{invites.get(agent.id)?.email}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{agent.code}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge
                        variant={agent.status === "Approved" && !agent.retiredAt ? "secondary" : "outline"}
                        className={cn(agent.status === "Approved" && !agent.retiredAt && "bg-emerald-50 text-emerald-800")}
                      >
                        {agent.status}
                      </Badge>
                      {agent.retiredAt ? (
                        <Badge variant="destructive">Retired</Badge>
                      ) : (
                        agent.switchedOffAt && <Badge variant="destructive">Switched off</Badge>
                      )}
                    </div>
                    {statusChangeLine(agent) && (
                      <p className="mt-1 max-w-64 text-xs text-muted-foreground">{statusChangeLine(agent)}</p>
                    )}
                    <InviteState note={invites?.get(agent.id)} />
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
                  {/* How many leads carry the code, so families waiting on
                      the discount can be put first. */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {agent.leadCount}
                  </td>
                  {canApprove && (
                    <td className="px-3 py-2">
                      {/* A retired record never changes again. */}
                      {!agent.retiredAt && (
                        <div className="flex flex-col items-start gap-2">
                          {agent.status === "Pending" && (
                            <ApproveAgent
                              agent={{ id: agent.id, fullName: agent.fullName, code: agent.code }}
                              email={invites?.get(agent.id)?.email ?? null}
                              emailUnknown={invites === null}
                            />
                          )}
                          <AgentInviteActions
                            agent={{ id: agent.id, fullName: agent.fullName, code: agent.code }}
                            email={invites?.get(agent.id)?.email ?? null}
                            state={invites?.get(agent.id)?.state ?? null}
                            everSent={Boolean(invites?.get(agent.id)?.sentAt)}
                            emailUnknown={invites === null}
                          />
                          <AgentStatusActions
                            agent={{ id: agent.id, fullName: agent.fullName, code: agent.code }}
                            switchedOff={agent.switchedOffAt !== null}
                          />
                          <RecreateAgent agent={{ id: agent.id, fullName: agent.fullName, code: agent.code }} />
                        </div>
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

function InviteState({ note }: { note: AgentInviteNote | undefined }) {
  if (!note) return null
  return <AccountStateBadge state={note.state} line={inviteLine(note)} />
}
