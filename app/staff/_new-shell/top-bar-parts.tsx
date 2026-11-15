"use client"

import Form from "next/form"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useState, useTransition, type MouseEvent } from "react"
import { useFormStatus } from "react-dom"

import { Button, Field, ListRow, Note, Popover, RoundButton } from "@/components/kit"

import { signOut } from "../actions"
import type { ShellPerson } from "../shell-types"
import { loadBellRequests } from "./bell-actions"
import type { BellRequest } from "./bell-requests"

/**
 * The 40px search: searching opens Applicants with the term. On Applicants
 * it holds the search the list shows, and carries the list's filters, so
 * Clear returns to the filtered list (#324).
 */
export function TopBarSearch() {
  return (
    <Suspense fallback={<SearchForm query="" carried={[]} />}>
      <ApplicantsAwareSearch />
    </Suspense>
  )
}

// The filters the Applicants list keeps in its address (app/staff/applicants/search-params.ts).
const CARRIED = ["status", "closure", "earlier_link", "import"] as const

function ApplicantsAwareSearch() {
  const onApplicants = usePathname() === "/staff/applicants"
  const params = useSearchParams()
  const query = onApplicants ? (params.get("q") ?? "") : ""
  const carried = onApplicants
    ? CARRIED.flatMap((name) => {
        const value = params.get(name)
        return value ? [[name, value] as const] : []
      })
    : []
  return <SearchForm query={query} carried={carried} />
}

function SearchForm({ query, carried }: { query: string; carried: readonly (readonly [string, string])[] }) {
  return (
    <Form action="/staff/applicants" role="search" className="ns-search">
      {carried.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* Keyed on the search, so the box follows Clear, Back and Forward. */}
      <Field
        key={query}
        defaultValue={query}
        size="search"
        icon="search"
        name="q"
        placeholder="Search a name or Admission Number"
        aria-label="Search applicants"
        autoComplete="off"
      />
    </Form>
  )
}

type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; requests: BellRequest[] }

/**
 * The bell (DESIGN.md, Top bar parts): the orange pip counts the Pending
 * Discount and Reopening requests this person may decide. Opening the
 * popover loads the list and hides the pip until the next page load, or
 * until more requests arrive.
 */
export function Bell({ pending }: { pending: number }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" })
  const [, startLoading] = useTransition()
  const unread = pending > seen ? pending : 0

  function load() {
    setLoaded({ state: "loading" })
    startLoading(async () => {
      try {
        const result = await loadBellRequests()
        setLoaded(result.ok ? { state: "ready", requests: result.data } : { state: "failed" })
      } catch {
        setLoaded({ state: "failed" })
      }
    })
  }

  // A chosen request opens its screen; the popover closes with it.
  function closeOnLink(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("a")) setOpen(false)
  }

  return (
    <span className="ns-bellw">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setSeen(pending)
            load()
          }
        }}
        trigger={<RoundButton icon="bell" label={unread ? `New requests, ${unread} waiting` : "New requests"} size={40} />}
        title="New requests"
        closeLabel="Close"
      >
        {loaded.state === "loading" && (
          <p role="status" className="ns-pop-line">
            Loading…
          </p>
        )}
        {loaded.state === "failed" && (
          <Note tone="bad" role="alert">
            The requests could not be loaded. Try again in a moment.
          </Note>
        )}
        {loaded.state === "ready" &&
          (loaded.requests.length === 0 ? (
            <p className="ns-pop-line">Nothing is waiting.</p>
          ) : (
            <div className="ns-requests" onClick={closeOnLink}>
              {loaded.requests.map((request) => (
                <ListRow key={request.key} icon={request.icon} title={request.title} caption={request.caption} href={request.href} />
              ))}
            </div>
          ))}
      </Popover>
      {unread > 0 && (
        <i className="ns-pip" aria-hidden="true">
          {unread}
        </i>
      )}
    </span>
  )
}

/** Up to two initials: "Test Admissions" is TA. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("")
}

function SignOutButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="ghost" pending={pending}>
      Sign out
    </Button>
  )
}

/**
 * The signed-in person's pill: initials, then the name over the role (only
 * the initials on a phone). It opens the account menu with Sign out, which
 * submits to the same server action as the old shell's.
 */
export function PersonMenu({ person }: { person: ShellPerson }) {
  return (
    <Popover
      size="narrow"
      trigger={
        <button type="button" className="ns-me">
          <i aria-hidden="true">{initials(person.name)}</i>
          <span>
            <b>{person.name}</b>
            <small>{person.roleName}</small>
          </span>
        </button>
      }
      title={person.name}
      description={person.roleName}
      closeLabel="Close"
    >
      <form action={signOut} className="ns-signout">
        <SignOutButton />
      </form>
    </Popover>
  )
}
