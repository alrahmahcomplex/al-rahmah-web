import type { Metadata } from "next"
import Form from "next/form"
import Link from "next/link"
import { forbidden } from "next/navigation"
import type { ReactNode } from "react"

import { Button, ButtonLink, Card, EmptyState, Field, Note, PageHeader, pageTitle } from "@/components/kit"
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
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { AgentAccessBanner } from "./access-banner"
import { ClaimQueue } from "./claim-queue"
import { CreateAgent } from "./create-agent"
import { AgentsTable, type AgentRow } from "./agents-table"
import type { DiscountAgent } from "./discount-sheet"
import { Tabs } from "./form-parts"
import { SendInvites } from "./invite-batch"
import { budgetLine } from "./invite-batch-outcome"
import { InviteBatchReportPanel } from "./invite-batch-report"
import { inviteLine, needsAttention } from "./invite-outcome"
import { statusChangeLine } from "./outcome"
import { StandardDiscount } from "./standard-discount-sheet"
import { accountParam, agentsHref, outcomeParam, parseAgentSearch, statusParam, type AgentScreenSearch } from "./search-params"
import "./agents.css"

// Send invites runs as a Server Action of this page, one invite at a time,
// and stops itself at BATCH_TIME_LIMIT_MS (45 s). Sixty seconds is within
// Vercel Hobby's function limit with or without Fluid compute.
export const maxDuration = 60

export const metadata: Metadata = {
  title: pageTitle("Marketing Agents"),
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

  // The status filters, then the account-state filters with their counts.
  // One is current at most.
  const tabs = [
    ...FILTERS.map((filter) => ({
      label: filter.label as ReactNode,
      href: agentsHref(search, {
        status: filter.status,
        account: undefined,
        batchId: undefined,
        batchOutcome: undefined,
        page: 1,
      }),
      current: !search.account && !search.batchOutcome && filter.status === search.status,
    })),
    ...(counts.ok
      ? ACCOUNT_FILTERS.map((filter) => ({
          label: (
            <>
              {filter.label}
              <span className="ag-num">
                &nbsp;({accountFilterStates(filter.account).reduce((sum, state) => sum + counts.data[state], 0)})
              </span>
            </>
          ),
          href: agentsHref(search, { account: filter.account, batchId: undefined, batchOutcome: undefined, page: 1 }),
          current: search.account === filter.account && !search.batchOutcome,
        }))
      : []),
  ]

  return (
    <div className="ag-page">
      <PageHeader
        title="Marketing Agents"
        actions={
          canApprove && (
            <>
              <ButtonLink href="/staff/agents/import" variant="ghost">
                Import from CSV
              </ButtonLink>
              <CreateAgent />
            </>
          )
        }
      />

      <AgentAccessBanner access={access} />

      {standard.ok ? (
        <StandardDiscount
          amount={standard.data.amount}
          agentsOnStandard={standard.data.approvedAgentsOnStandard}
          canManage={canManageDiscounts}
        />
      ) : (
        <Note tone="bad" role="alert">
          The standard discount could not be loaded. Try again in a moment.
        </Note>
      )}

      <div className="ag-stack">
        {/* Keyed on the URL, so the box shows the search the page is showing. */}
        <Form key={agentsHref(search)} action="/staff/agents" role="search" className="ag-search">
          <input type="hidden" name="status" value={statusParam(search.status)} />
          {search.account && <input type="hidden" name="account" value={accountParam(search.account)} />}
          {search.batchId && <input type="hidden" name="batch" value={search.batchId} />}
          {search.batchId && search.batchOutcome && (
            <input type="hidden" name="outcome" value={outcomeParam(search.batchOutcome)} />
          )}
          {search.importBatchId && <input type="hidden" name="import" value={search.importBatchId} />}
          <label htmlFor="agent-search" className="ag-label">
            Search agents
          </label>
          <div>
            <Field
              id="agent-search"
              name="q"
              type="search"
              size="compact"
              alignStart
              defaultValue={search.query ?? ""}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="agent-search-hint"
            />
            <Button type="submit" variant="ghost">
              Search
            </Button>
          </div>
          <p id="agent-search-hint" className="ag-hint">
            A name, a code, or a phone number.
          </p>
        </Form>

        <Tabs label="Agent status" tabs={tabs} current={tabs.find((tab) => tab.current)?.href ?? null}>
          {search.query && (
            <Link href={agentsHref(search, { query: undefined, page: 1 })} className="ag-link">
              Clear search
            </Link>
          )}
        </Tabs>
        {attention && <NeedsAttention attention={attention} pending={pendingCount?.ok ? pendingCount.data : null} />}
      </div>

      {search.importBatchId && (
        <Note>
          {batch?.ok && batch.data ? (
            <>
              Agents created by the import of <span className="ag-strong ag-wrap">{batch.data.fileName}</span> on{" "}
              <time dateTime={batch.data.importedAt}>{WHEN.format(new Date(batch.data.importedAt))}</time>
              {batch.data.importedBy ? ` by ${batch.data.importedBy}` : ""}
            </>
          ) : (
            "Agents created by an import that can't be found"
          )}{" "}
          <Link href={agentsHref(search, { importBatchId: undefined, page: 1 })} className="ag-link">
            Show every agent
          </Link>
        </Note>
      )}

      {showsBatches && (
        <div className="ag-stack">
          {canApprove && search.account === "no_account" && (
            <div className="ag-cell">
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
            <Note tone="bad" role="alert">
              The latest invite batch could not be loaded. Reload the page in a moment.
            </Note>
          )}
          {inviteBatch?.ok && inviteBatch.data && <InviteBatchReportPanel report={inviteBatch.data} search={search} />}
          {inviteBatch?.ok && !inviteBatch.data && search.batchId && (
            <p className="ag-p ag-quiet">That invite batch can&apos;t be found.</p>
          )}
        </div>
      )}

      {invites && !invites.ok && (
        <Note tone="bad" role="alert">
          The agents&apos; emails and invites could not be loaded, so Approve, Send invite and Edit email are off. Reload the page in a
          moment.
        </Note>
      )}

      {queue ? (
        !queue.ok ? (
          <Note tone="bad" role="alert">
            The email claims could not be loaded. Try again in a moment.
          </Note>
        ) : (
          <section aria-label="Results" className="ag-stack">
            {queue.data.length === 0 ? (
              <Card role="status">
                <EmptyState title="No email claims are waiting." />
              </Card>
            ) : (
              <p className="ag-p ag-quiet" aria-live="polite">
                {`${queue.data.length} ${queue.data.length === 1 ? "agent" : "agents"} awaiting email confirmation, oldest first`}
              </p>
            )}
            {queue.data.length > 0 && <ClaimQueue entries={queue.data} canApprove={canApprove} />}
          </section>
        )
      ) : !results.ok ? (
        <Note tone="bad" role="alert">
          Marketing Agents could not be loaded. Try again in a moment.
        </Note>
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
    <p className="ag-p">
      {pending !== null && <span className="ag-strong">Pending: {pending} · </span>}
      <span className="ag-strong">Needs attention: {attention.total}</span>
      <span className="ag-quiet">
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

type Agent = AgentList["agents"][number]

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

  const rows: AgentRow[] = agents.map((agent) => {
    const invite = invites?.get(agent.id)
    return {
      id: agent.id,
      fullName: agent.fullName,
      code: agent.code,
      phone: agent.phone,
      phoneShown: displayPhone(agent.phone),
      whatsappShown: agent.whatsapp ? displayPhone(agent.whatsapp) : null,
      email: invite?.email ?? null,
      typedCode: typedCodeNote(signUpNotes?.get(agent.id)),
      status: agent.status,
      approved: agent.status === "Approved",
      retired: agent.retiredAt !== null,
      switchedOff: agent.switchedOffAt !== null,
      statusLine: statusChangeLine(agent) || null,
      invite: invite ? { state: invite.state, line: inviteLine(invite) } : null,
      discount: discountAgent(agent),
      discountAmount: agent.discountAmount,
      onStandard: agent.interviewDiscount === null,
      registeredAt: agent.registeredAt,
      registeredShown: WHEN.format(new Date(agent.registeredAt)),
      approvedBy: agent.approvedBy,
      approvedAt: agent.approvedAt,
      approvedShown: agent.approvedAt ? WHEN.format(new Date(agent.approvedAt)) : null,
      leadCount: agent.leadCount,
      inviteState: invite?.state ?? null,
      everSent: Boolean(invite?.sentAt),
      joined: invite?.joined ?? false,
    }
  })

  return (
    <section aria-label="Results" className="ag-stack">
      {total === 0 ? (
        <Card role="status">
          <EmptyState title={empty} />
        </Card>
      ) : (
        <p className="ag-p ag-quiet" aria-live="polite">
          {`${total} ${total === 1 ? "agent" : "agents"}`}
        </p>
      )}

      {agents.length > 0 && (
        <Card>
          <AgentsTable
            rows={rows}
            canApprove={canApprove}
            standard={standard?.amount ?? null}
            canManageDiscounts={canManageDiscounts}
            emailUnknown={invites === null}
          />
        </Card>
      )}

      {pageCount > 1 && (
        <nav aria-label="Pages" className="ag-pages">
          {page > 1 ? (
            <ButtonLink href={agentsHref(search, { page: page - 1 })} variant="ghost">
              Previous
            </ButtonLink>
          ) : null}
          <p>
            Page {page} of {pageCount}
          </p>
          {page < pageCount ? (
            <ButtonLink href={agentsHref(search, { page: page + 1 })} variant="ghost">
              Next
            </ButtonLink>
          ) : null}
        </nav>
      )}
    </section>
  )
}

// An agent as the discount sheet shows them.
function discountAgent(agent: Agent): DiscountAgent {
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

// A code typed at sign-up that the record didn't get (#193): flagged, never
// adopted, because someone holds or held it, or students carry it.
function typedCodeNote(note: SignUpNote | undefined): AgentRow["typedCode"] {
  if (!note) return null
  const reasons = [
    note.holder ? `it belongs to ${note.holder.fullName} (${note.holder.code})` : null,
    note.retiredHolder ? "a retired record held it" : null,
    note.leadCount > 0 ? `${note.leadCount} ${note.leadCount === 1 ? "student carries" : "students carry"} it` : null,
  ].filter(Boolean)
  return { code: note.typedCode, reasons: reasons.length > 0 ? `: ${reasons.join("; ")}` : "" }
}
