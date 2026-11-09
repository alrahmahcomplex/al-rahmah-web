import { MailCheckIcon, MegaphoneIcon, SearchXIcon } from "lucide-react"
import type { Metadata } from "next"
import Form from "next/form"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { EmptyState } from "@/components/staff/empty-state"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getAgentAccess } from "@/lib/services/agent-access"
import { accountFilterStates, listAgentsInAccountState, listAgentsInBatchOutcome } from "@/lib/services/agent-account-list"
import { getAgentImport } from "@/lib/services/agent-import"
import {
  BATCH_LIMIT,
  getInviteBatchReport,
  getInviteBudgetUsed,
  readInviteBudgetConfig,
  type BatchOutcome,
} from "@/lib/services/agent-invite-batches"
import { getStandardDiscountSummary, type StandardDiscountSummary } from "@/lib/services/discount-codes"
import { getEmailClaimQueue, getSignUpNotes, type SignUpNote } from "@/lib/services/agent-email-claims"
import { getAgentAccountCounts, getAgentInvites, type AgentInviteNote } from "@/lib/services/agent-invites"
import { getPendingAgentCount, listAgents, type AgentFilter, type AgentList } from "@/lib/services/marketing-agents"
import { cn } from "@/lib/utils"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { AgentAccessBanner } from "./access-banner"
import { AccountStateBadge, AgentInviteActions } from "./agent-invite"
import { AgentStatusActions } from "./agent-status-actions"
import { ApproveAgent } from "./approve-agent"
import { ClaimQueue } from "./claim-queue"
import { CreateAgent } from "./create-agent"
import { AgentDiscount, type DiscountAgent } from "./discount-sheet"
import { tzs } from "./discount-outcome"
import { SendInvites } from "./invite-batch"
import { budgetLine } from "./invite-batch-outcome"
import { InviteBatchReportPanel } from "./invite-batch-report"
import { inviteLine, needsAttention } from "./invite-outcome"
import { RecreateAgent } from "./recreate-agent"
import { statusChangeLine } from "./outcome"
import { StandardDiscount } from "./standard-discount-sheet"
import { accountParam, agentsHref, outcomeParam, parseAgentSearch, statusParam, type AgentScreenSearch } from "./search-params"

// Send invites runs as a Server Action of this page, one invite at a time,
// and stops itself at BATCH_TIME_LIMIT_MS (45 s). Sixty seconds is within
// Vercel Hobby's function limit with or without Fluid compute.
export const maxDuration = 60

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

// The account-state filters (#191, #192, #193), each with its count.
const ACCOUNT_FILTERS = [
  { account: "awaiting_confirmation", label: "Awaiting email confirmation" },
  { account: "no_account", label: "Approved, no account yet" },
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
  const canManageDiscounts = staff.permissions.includes("discount_codes.manage")

  const search = parseAgentSearch(await searchParams, canApprove)
  const supabase = await createClient()
  // "Approved, no account yet" shows the latest invite batch over the list it
  // shows; a batch's own link shows that batch.
  const showsBatches = search.account === "no_account" || search.batchId !== undefined
  // "Awaiting email confirmation" shows the claim queue in place of the list.
  const showsQueue = search.account === "awaiting_confirmation" && !search.batchOutcome
  const budgetConfig = readInviteBudgetConfig()
  const [results, batch, access, counts, pendingCount, inviteBatch, budgetUsed, queue, standard] = await Promise.all([
    search.batchId && search.batchOutcome
      ? listAgentsInBatchOutcome(supabase, search.batchId, search.batchOutcome, { query: search.query, page: search.page })
      : search.account
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
    showsBatches
      ? getInviteBatchReport(supabase, search.batchId ? { batchId: search.batchId } : { importBatchId: search.importBatchId })
      : null,
    canApprove && search.account === "no_account" && budgetConfig ? getInviteBudgetUsed(supabase) : null,
    showsQueue ? getEmailClaimQueue(supabase) : null,
    getStandardDiscountSummary(supabase),
  ])
  // The invite badge and line, and any code typed at sign-up, for each agent
  // on this page.
  const agentIds = results.ok ? results.data.agents.map((agent) => agent.id) : []
  const [invites, signUpNotes] = results.ok
    ? await Promise.all([getAgentInvites(supabase, agentIds), getSignUpNotes(supabase, agentIds)])
    : [null, null]
  const attention = counts.ok ? needsAttention(counts.data) : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="staff-heading">Marketing Agents</h1>
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

      {standard.ok ? (
        <StandardDiscount
          amount={standard.data.amount}
          agentsOnStandard={standard.data.approvedAgentsOnStandard}
          canManage={canManageDiscounts}
        />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>The standard discount could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        {/* Keyed on the URL, so the box shows the search the page is showing. */}
        <Form key={agentsHref(search)} action="/staff/agents" role="search" className="flex max-w-xl flex-col gap-1.5">
          <input type="hidden" name="status" value={statusParam(search.status)} />
          {search.account && <input type="hidden" name="account" value={accountParam(search.account)} />}
          {search.batchId && <input type="hidden" name="batch" value={search.batchId} />}
          {search.batchId && search.batchOutcome && (
            <input type="hidden" name="outcome" value={outcomeParam(search.batchOutcome)} />
          )}
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
            const current = !search.account && !search.batchOutcome && filter.status === search.status
            return (
              <Link
                key={filter.status}
                href={agentsHref(search, {
                  status: filter.status,
                  account: undefined,
                  batchId: undefined,
                  batchOutcome: undefined,
                  page: 1,
                })}
                aria-current={current ? "page" : undefined}
                className={buttonVariants({ variant: current ? "default" : "outline", size: "sm" })}
              >
                {filter.label}
              </Link>
            )
          })}
          {counts.ok &&
            ACCOUNT_FILTERS.map((filter) => {
              const current = search.account === filter.account && !search.batchOutcome
              return (
                <Link
                  key={filter.account}
                  href={agentsHref(search, { account: filter.account, batchId: undefined, batchOutcome: undefined, page: 1 })}
                  aria-current={current ? "page" : undefined}
                  className={buttonVariants({ variant: current ? "default" : "outline", size: "sm" })}
                >
                  {filter.label}
                  <span className="tabular-nums">
                    &nbsp;({accountFilterStates(filter.account).reduce((sum, state) => sum + counts.data[state], 0)})
                  </span>
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

      {showsBatches && (
        <div className="flex flex-col gap-3">
          {canApprove && search.account === "no_account" && (
            <div className="flex flex-col items-start gap-1">
              <SendInvites
                importBatchId={search.importBatchId ?? null}
                batchLimit={BATCH_LIMIT}
                budget={budgetLine(budgetConfig, budgetUsed?.ok ? budgetUsed.data : null)}
                disabledReason={
                  !budgetConfig
                    ? budgetLine(null, null)
                    : access.ok && !access.data.enabled
                      ? "Agent access is off, so no invites can be sent."
                      : null
                }
              />
            </div>
          )}
          {inviteBatch && !inviteBatch.ok && (
            <Alert variant="destructive">
              <AlertDescription>The latest invite batch could not be loaded. Reload the page in a moment.</AlertDescription>
            </Alert>
          )}
          {inviteBatch?.ok && inviteBatch.data && <InviteBatchReportPanel report={inviteBatch.data} search={search} />}
          {inviteBatch?.ok && !inviteBatch.data && search.batchId && (
            <p className="text-sm text-muted-foreground">That invite batch can&apos;t be found.</p>
          )}
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

      {queue ? (
        !queue.ok ? (
          <Alert variant="destructive">
            <AlertDescription>The email claims could not be loaded. Try again in a moment.</AlertDescription>
          </Alert>
        ) : (
          <section aria-label="Results" className="flex flex-col gap-3">
            {queue.data.length === 0 ? (
              <EmptyState role="status" icon={MailCheckIcon} title="No email claims are waiting." />
            ) : (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {`${queue.data.length} ${queue.data.length === 1 ? "agent" : "agents"} awaiting email confirmation, oldest first`}
              </p>
            )}
            {queue.data.length > 0 && <ClaimQueue entries={queue.data} canApprove={canApprove} />}
          </section>
        )
      ) : !results.ok ? (
        <Alert variant="destructive">
          <AlertDescription>Marketing Agents could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <Results
          results={results.data}
          search={search}
          canApprove={canApprove}
          invites={invites?.ok ? invites.data : null}
          signUpNotes={signUpNotes?.ok ? signUpNotes.data : null}
          standard={standard.ok ? standard.data : null}
          canManageDiscounts={canManageDiscounts}
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

const BATCH_EMPTY: Record<BatchOutcome, string> = {
  sent: "No invite went out in this batch.",
  waiting: "No agent is waiting for an invite.",
  no_email: "Every agent here has an email.",
  failed: "No invite failed in this batch.",
}

const ACCOUNT_EMPTY: Record<NonNullable<AgentScreenSearch["account"]>, string> = {
  awaiting_confirmation: "No email claims are waiting.",
  no_account: "Every Approved agent has an account.",
  invite_not_sent: "Every Approved agent with an email has been sent an invite.",
  invite_expired: "No agent's invite link has expired.",
}

function Results({
  results,
  search,
  canApprove,
  invites,
  signUpNotes,
  standard,
  canManageDiscounts,
}: {
  results: AgentList
  search: AgentScreenSearch
  canApprove: boolean
  // Null when they couldn't be read: the actions that use the email are off.
  invites: Map<string, AgentInviteNote> | null
  // Codes typed at sign-up that weren't adopted; null when unread.
  signUpNotes: Map<string, SignUpNote> | null
  // Null when it couldn't be read: the amounts show without their sheet.
  standard: StandardDiscountSummary | null
  canManageDiscounts: boolean
}) {
  const { agents, total, page, pageCount } = results
  const empty = search.query
    ? "No agent matches this search."
    : search.batchId && search.batchOutcome
      ? BATCH_EMPTY[search.batchOutcome]
      : search.account
      ? ACCOUNT_EMPTY[search.account]
      : EMPTY[search.status]

  return (
    <section aria-label="Results" className="flex flex-col gap-3">
      {total === 0 ? (
        <EmptyState role="status" icon={search.query ? SearchXIcon : MegaphoneIcon} title={empty} />
      ) : (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {`${total} ${total === 1 ? "agent" : "agents"}`}
        </p>
      )}

      {agents.length > 0 && (
        <div className="relative overflow-x-auto rounded-lg ring-1 ring-foreground/10">
          {/* Relative, so the table's screen-reader-only text scrolls with it
              instead of widening the page on a phone. */}
          <table aria-label="Marketing Agents" className="w-full min-w-[60rem] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Phone</th>
                <th scope="col" className="px-3 py-2 font-medium">Code</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Interview discount</th>
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
                  <td className="px-3 py-2">
                    <span className="font-mono whitespace-nowrap">{agent.code}</span>
                    <TypedCodeNote note={signUpNotes?.get(agent.id)} />
                  </td>
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
                  <td className="px-3 py-2">
                    {/* A retired record has no actions left, so its amount is text. */}
                    {standard && !agent.retiredAt ? (
                      <AgentDiscount agent={discountAgent(agent)} standard={standard.amount} canManage={canManageDiscounts} />
                    ) : (
                      <span className="whitespace-nowrap">
                        <span className="font-medium text-slate-900 tabular-nums">{tzs(agent.discountAmount)}</span>{" "}
                        <span className="text-muted-foreground">{agent.interviewDiscount === null ? "standard" : "own amount"}</span>
                      </span>
                    )}
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
                            joined={invites?.get(agent.id)?.joined ?? false}
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

// An agent as the discount sheet shows them.
function discountAgent(agent: AgentList["agents"][number]): DiscountAgent {
  const status: DiscountAgent["status"] = agent.retiredAt
    ? { label: "Retired", tone: "bad" }
    : agent.switchedOffAt
      ? { label: "Switched off", tone: "bad" }
      : agent.status === "Approved"
        ? { label: "Approved", tone: "good" }
        : { label: "Pending", tone: "warn" }
  return {
    id: agent.id,
    fullName: agent.fullName,
    code: agent.code,
    phone: displayPhone(agent.phone),
    status,
    studentCount: agent.leadCount,
    interviewDiscount: agent.interviewDiscount,
    retired: agent.retiredAt !== null,
  }
}

function InviteState({ note }: { note: AgentInviteNote | undefined }) {
  if (!note) return null
  return <AccountStateBadge state={note.state} line={inviteLine(note)} />
}

// A code typed at sign-up that the record didn't get (#193): flagged, never
// adopted, because someone holds or held it, or students carry it.
function TypedCodeNote({ note }: { note: SignUpNote | undefined }) {
  if (!note) return null
  const reasons = [
    note.holder ? `it belongs to ${note.holder.fullName} (${note.holder.code})` : null,
    note.retiredHolder ? "a retired record held it" : null,
    note.leadCount > 0 ? `${note.leadCount} ${note.leadCount === 1 ? "student carries" : "students carry"} it` : null,
  ].filter(Boolean)
  return (
    <p className="mt-1 max-w-56 text-xs text-amber-900">
      Typed <span className="font-mono">{note.typedCode}</span> at sign-up, not used
      {reasons.length > 0 ? `: ${reasons.join("; ")}` : ""}.
    </p>
  )
}
