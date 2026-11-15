"use client"

import { Table, Tag, type TableColumn } from "@/components/kit"
import type { AccountState } from "@/lib/services/agent-invites"

import { AccountStateBadge, AgentInviteActions } from "./agent-invite"
import { AgentStatusActions } from "./agent-status-actions"
import { ApproveAgent } from "./approve-agent"
import { AgentDiscount, type DiscountAgent } from "./discount-sheet"
import { tzs } from "./discount-outcome"
import { RecreateAgent } from "./recreate-agent"
import "./agents.css"

// One agent as the Marketing Agents table shows them, read and worded on the
// server: the kit's Table runs in the browser, so its cells are drawn here.
export type AgentRow = {
  id: string
  fullName: string
  code: string
  phone: string
  phoneShown: string
  whatsappShown: string | null
  email: string | null
  // A code typed at sign-up and not used, already worded.
  typedCode: { code: string; reasons: string } | null
  status: string
  approved: boolean
  retired: boolean
  switchedOff: boolean
  statusLine: string | null
  invite: { state: AccountState | null; line: string | null } | null
  discount: DiscountAgent
  discountAmount: number
  onStandard: boolean
  registeredAt: string
  registeredShown: string
  approvedBy: string | null
  approvedAt: string | null
  approvedShown: string | null
  leadCount: number
  inviteState: AccountState | null
  everSent: boolean
  joined: boolean
}

export function AgentsTable({
  rows,
  canApprove,
  standard,
  canManageDiscounts,
  emailUnknown,
}: {
  rows: AgentRow[]
  canApprove: boolean
  // Null when it couldn't be read: the amounts show without their sheet.
  standard: number | null
  canManageDiscounts: boolean
  // The emails couldn't be read: the actions that use them are off.
  emailUnknown: boolean
}) {
  const columns: TableColumn<AgentRow>[] = [
    { header: "Name", rowHeader: true, cell: (agent) => agent.fullName },
    {
      header: "Phone",
      cell: (agent) => (
        <span className="ag-cell">
          <a href={`tel:${agent.phone}`} className="ag-tel ag-nowrap">
            {agent.phoneShown}
          </a>
          {agent.whatsappShown && <small className="ag-nowrap">WhatsApp {agent.whatsappShown}</small>}
          {agent.email && <small>{agent.email}</small>}
        </span>
      ),
    },
    {
      header: "Code",
      cell: (agent) => (
        <>
          <span className="ag-mono ag-nowrap">{agent.code}</span>
          {agent.typedCode && (
            <p className="ag-typed">
              Typed <span className="ag-mono">{agent.typedCode.code}</span> at sign-up, not used{agent.typedCode.reasons}.
            </p>
          )}
        </>
      ),
    },
    {
      header: "Status",
      cell: (agent) => (
        <span className="ag-cell">
          <span className="ag-row">
            <Tag tone={agent.approved && !agent.retired ? "ok" : "line"}>{agent.status}</Tag>
            {agent.retired ? <Tag tone="bad">Retired</Tag> : agent.switchedOff && <Tag tone="bad">Switched off</Tag>}
          </span>
          {agent.statusLine && <small>{agent.statusLine}</small>}
          {agent.invite && <AccountStateBadge state={agent.invite.state} line={agent.invite.line} />}
        </span>
      ),
    },
    {
      header: "Interview discount",
      // A retired record has no actions left, so its amount is text.
      cell: (agent) =>
        standard !== null && !agent.retired ? (
          <AgentDiscount agent={agent.discount} standard={standard} canManage={canManageDiscounts} />
        ) : (
          <span className="ag-nowrap">
            <span className="ag-strong ag-num">{tzs(agent.discountAmount)}</span>{" "}
            <span className="ag-quiet">{agent.onStandard ? "standard" : "own amount"}</span>
          </span>
        ),
    },
    {
      header: "Registered",
      cell: (agent) => (
        <time dateTime={agent.registeredAt} className="ag-nowrap">
          {agent.registeredShown}
        </time>
      ),
    },
    {
      header: "Approved",
      cell: (agent) =>
        agent.approvedAt ? (
          <span className="ag-cell">
            <span>{agent.approvedBy ?? "Unknown"}</span>
            <time dateTime={agent.approvedAt} className="ag-small ag-quiet ag-nowrap">
              {agent.approvedShown}
            </time>
          </span>
        ) : (
          <span className="ag-quiet">Not yet</span>
        ),
    },
    // How many leads carry the code, so families waiting on the discount can
    // be put first.
    { header: "Applicants", align: "end", cell: (agent) => agent.leadCount },
  ]
  if (canApprove) {
    columns.push({
      header: <span className="sr-only">Actions</span>,
      // A retired record never changes again.
      cell: (agent) => {
        if (agent.retired) return null
        const who = { id: agent.id, fullName: agent.fullName, code: agent.code }
        return (
          <div className="ag-actions">
            {agent.status === "Pending" && <ApproveAgent agent={who} email={agent.email} emailUnknown={emailUnknown} />}
            <AgentInviteActions
              agent={who}
              email={agent.email}
              state={agent.inviteState}
              everSent={agent.everSent}
              joined={agent.joined}
              emailUnknown={emailUnknown}
            />
            <AgentStatusActions agent={who} switchedOff={agent.switchedOff} />
            <RecreateAgent agent={who} />
          </div>
        )
      },
    })
  }
  return <Table label="Marketing Agents" columns={columns} rows={rows} rowKey={(agent) => agent.id} />
}
