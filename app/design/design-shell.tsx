"use client"

import { useRouter, useSelectedLayoutSegment } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"

import { NewShell } from "@/app/staff/_new-shell/new-shell"
import type { ShellItem, ShellSections } from "@/app/staff/shell-types"
import { Icon } from "@/components/icons"
import { Button, Field, Popover } from "@/components/kit"
import { PART_GROUPS, partsIn } from "@/lib/design-site/catalog"

import { lockDesign } from "./actions"
import { useDesignHref } from "./design-href"
import { PartSearch } from "./part-search"

// The design site's frame (prototype v6): the staff shell, the site's
// signature, with the design pages in its sidebar, the Design system page's
// sections under its row, the parts search and the lock pill in the top bar.

const GROUPS = ["Pages"] as const
// Parts added in the design site round, marked in the sidebar.
const NEW_PARTS = new Set(["password-field", "code-block"])

const SECTIONS: ShellSections["groups"] = PART_GROUPS.map((group) => ({
  name: group,
  sections: partsIn(group).map((part) => ({ id: part.id, label: part.title, badge: NEW_PARTS.has(part.id) ? "New" : undefined })),
}))

function LockPill() {
  const [locking, startLocking] = useTransition()
  return (
    <Popover
      size="narrow"
      trigger={
        <button type="button" className="ns-me" data-icon-host="">
          <i aria-hidden="true" data-icon-host="indigo">
            <Icon name="lock" size={16} featured />
          </i>
          <span>
            <b>Open</b>
            <small>For 30 days</small>
          </span>
        </button>
      }
      title="This browser is open"
      description="It stays open for 30 days. Lock it on a shared computer."
      closeLabel="Close"
    >
      <Button
        variant="ghost"
        size="wide"
        icon="lock"
        pending={locking}
        onClick={() =>
          startLocking(async () => {
            await lockDesign()
            window.location.reload()
          })
        }
      >
        {locking ? "Locking…" : "Lock this browser"}
      </Button>
    </Popover>
  )
}

export function DesignShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const kit = useDesignHref("")
  const connect = useDesignHref("/connect")
  const onConnect = useSelectedLayoutSegment() === "connect"
  const [query, setQuery] = useState("")

  const items: ShellItem[] = [
    { href: kit, label: "Design system", group: "Pages", iconName: "house" },
    { href: connect, label: "Connect an AI", group: "Pages", iconName: "link" },
  ]

  return (
    <PartSearch.Provider value={query}>
      <NewShell
        shellApp="design"
        items={items}
        groups={GROUPS}
        sections={{ href: kit, groups: SECTIONS }}
        currentHref={onConnect ? connect : kit}
        brandSubtitle="Design system"
        navLabel="Design system"
        bell={null}
        canSearch={false}
        folded={false}
        sidebarWidth={null}
        topBarEnd={
          <>
            <form
              role="search"
              className="ns-search"
              onSubmit={(event) => {
                event.preventDefault()
                if (onConnect) router.push(kit)
              }}
            >
              <Field
                size="search"
                icon="search"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  if (onConnect && event.target.value.trim()) router.push(kit)
                }}
                placeholder="Search a part or a colour"
                aria-label="Search the design system"
              />
            </form>
            <span className="ns-spacer" />
            <LockPill />
          </>
        }
      >
        {children}
      </NewShell>
    </PartSearch.Provider>
  )
}
