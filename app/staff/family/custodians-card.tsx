"use client"

import { useState } from "react"

import { Icon } from "@/components/icons"
import { Card, TextLink } from "@/components/kit"
import type { Relationship } from "@/lib/services/leads"
import { list } from "@/lib/sibling-sentences"

import { CustodianSheet, type CustodianView } from "./custodian-sheet"

// The Custodians card (#512, prototype v54): each custodian once, with the
// students on the page they are custodian of, their numbers and Change,
// then who brought the students on the visit.

export type CustodianCardData = Omit<CustodianView, "members" | "children"> & {
  members: (CustodianView["members"][number] & { firstName: string })[]
  // Null when it may not be changed here.
  children: CustodianView["children"] | null
}

const said = (m: { relationship: Relationship; relationshipDescription: string | null }) =>
  m.relationship === "Other" && m.relationshipDescription ? m.relationshipDescription : m.relationship

function relationshipLine(members: CustodianCardData["members"]) {
  const each = members.map(said)
  if (each.every((r) => r === each[0])) return each[0]
  return members.map((m) => `${said(m)} of ${m.firstName}`).join(" · ")
}

export function CustodiansCard({ custodians, broughtBy }: { custodians: CustodianCardData[]; broughtBy: string[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  // Each Change mounts the sheet afresh, so it starts from the custodian as they are now.
  const [session, setSession] = useState(0)
  return (
    <Card title="Custodians" className="fam-side">
      {custodians.map((c) => (
        <div key={c.contactId} className="fam-c">
          <div className="fam-c-t">
            <Icon name="user" size={16} />
            <b>{c.fullName}</b>
            <span>· {relationshipLine(c.members)}</span>
            {c.children && (
              <TextLink aria-label={`Change the custodian ${c.fullName}`} onClick={() => {
                  setSession((n) => n + 1)
                  setEditing(c.contactId)
                }}>
                Change
              </TextLink>
            )}
          </div>
          <small>Custodian of {list(c.members.map((m) => m.firstName), "and")}</small>
          <div className="fam-c-p kit-num">
            <Icon name="phone" size={16} />
            <span>
              {c.phone}
              {c.whatsapp ? ` · WhatsApp ${c.whatsapp}` : ""}
            </span>
          </div>
          {c.children && (
            <CustodianSheet
              key={session}
              custodian={{ ...c, children: c.children }}
              open={editing === c.contactId}
              onOpenChange={(open) => setEditing(open ? c.contactId : null)}
            />
          )}
        </div>
      ))}
      {broughtBy.length > 0 && (
        <div className="fam-c">
          <small>Brought on the visit by</small>
          {broughtBy.map((who) => (
            <b key={who}>{who}</b>
          ))}
        </div>
      )}
    </Card>
  )
}
