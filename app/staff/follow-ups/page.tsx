import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getFollowUpQueue, type FollowUpQueueItem, type FollowUpQueuePage, type FollowUpQueueSection } from "@/lib/services/follow-ups"
import { createClient } from "@/utils/supabase/server"

import { dueLabel } from "../leads/[id]/follow-up-outcome"
import { displayPhone } from "../re-applications/format"
import { requireStaff } from "../session"
import { lastContactText, overdueText, splitToday } from "./queue-format"
import { followUpsHref, parseFollowUpSearch, type FollowUpSearch } from "./search-params"

export const metadata: Metadata = {
  title: "Follow-ups · Al-Rahmah Complex",
}

// The follow-up queue: Overdue, oldest first, then Upcoming, with today's
// follow-ups under Today and later ones nearest first. Each section pages 50
// rows at a time. A row opens the lead's Follow-ups panel, where staff who
// may record follow-ups act; the queue itself has no actions.
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) forbidden()

  const search = parseFollowUpSearch(await searchParams)
  const supabase = await createClient()
  const [overdue, upcoming] = await Promise.all([
    getFollowUpQueue(supabase, { section: "overdue", page: search.overdue }),
    getFollowUpQueue(supabase, { section: "upcoming", page: search.upcoming }),
  ])
  const today = tanzaniaToday()

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Follow-ups</h1>

      <Section section="overdue" title="Overdue" result={overdue} search={search}>
        {(page) =>
          page.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {page.total === 0 ? "No follow-ups are overdue." : "This page is past the end of the list."}
            </p>
          ) : (
            <Rows items={page.items} today={today} label="Overdue follow-ups" />
          )
        }
      </Section>

      <Section section="upcoming" title="Upcoming" result={upcoming} search={search}>
        {(page) => {
          if (page.items.length === 0) {
            return (
              <p className="text-sm text-muted-foreground">
                {page.total === 0 ? "No follow-ups are coming up." : "This page is past the end of the list."}
              </p>
            )
          }
          const { today: dueToday, later } = splitToday(page.items, today)
          return (
            <>
              {dueToday.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 id="follow-ups-today" className="text-sm font-semibold text-slate-900">
                    Today
                  </h3>
                  <Rows items={dueToday} today={today} labelledBy="follow-ups-today" />
                </div>
              )}
              {later.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 id="follow-ups-later" className="text-sm font-semibold text-slate-900">
                    Later
                  </h3>
                  <Rows items={later} today={today} labelledBy="follow-ups-later" />
                </div>
              )}
            </>
          )
        }}
      </Section>
    </div>
  )
}

function Section({
  section,
  title,
  result,
  search,
  children,
}: {
  section: FollowUpQueueSection
  title: string
  result: Awaited<ReturnType<typeof getFollowUpQueue>>
  search: FollowUpSearch
  children: (page: FollowUpQueuePage) => React.ReactNode
}) {
  const headingId = `follow-ups-${section}`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold text-slate-900">
        {title}
        {result.ok && result.data.total > 0 && (
          <Badge variant={section === "overdue" ? "destructive" : "secondary"}>{result.data.total}</Badge>
        )}
      </h2>
      {!result.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{title} follow-ups could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <>
          {children(result.data)}
          <Pages section={section} title={title} page={result.data} search={search} />
        </>
      )}
    </section>
  )
}

function Rows({
  items,
  today,
  label,
  labelledBy,
}: {
  items: FollowUpQueueItem[]
  today: string
  label?: string
  labelledBy?: string
}) {
  return (
    <ul aria-label={label} aria-labelledby={labelledBy} className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
      {items.map((item) => (
        <Row key={`${item.kind}:${item.followUpId}`} item={item} today={today} />
      ))}
    </ul>
  )
}

// One follow-up. The whole row opens the lead's Follow-ups panel; the phone
// sits above that link so a tap on it calls the family.
function Row({ item, today }: { item: FollowUpQueueItem; today: string }) {
  const due = item.daysOverdue > 0 ? { text: overdueText(item.daysOverdue), overdue: true } : dueLabel(item.dueOn, today)
  return (
    <li className="relative flex flex-col gap-2 p-4 text-sm hover:bg-slate-50 sm:flex-row sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/staff/leads/${item.lead.id}#lead-follow-ups`}
            className="font-medium text-slate-900 underline-offset-4 after:absolute after:inset-0 hover:underline"
          >
            {item.lead.studentName}
          </Link>
          <span className="font-mono text-xs text-muted-foreground">{item.lead.admissionNumber}</span>
          <Badge variant="secondary">{item.lead.status}</Badge>
        </p>
        <p className="text-muted-foreground">
          {item.lead.className} · {item.lead.enrollmentYear}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <time dateTime={item.dueOn} className="font-medium text-slate-900">
            {formatDate(item.dueOn)}
          </time>
          <Badge variant={due.overdue ? "destructive" : "outline"}>{due.text}</Badge>
        </p>
        {item.note && <p className="break-words whitespace-pre-line text-slate-900">{item.note}</p>}
        <p className="text-xs text-muted-foreground">{lastContactText(item.lastContact)}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-0.5 sm:items-end sm:text-right">
        <p className="text-slate-900">{item.guardian.name}</p>
        <a
          href={`tel:${item.guardian.phone}`}
          className="relative z-10 inline-flex min-h-8 items-center font-medium text-blue-600 underline-offset-4 hover:underline"
        >
          {displayPhone(item.guardian.phone)}
        </a>
      </div>
    </li>
  )
}

function Pages({
  section,
  title,
  page,
  search,
}: {
  section: FollowUpQueueSection
  title: string
  page: FollowUpQueuePage
  search: FollowUpSearch
}) {
  if (page.pageCount <= 1 && page.page === 1) return null
  return (
    <nav aria-label={`${title} pages`} className="flex items-center gap-3">
      {page.page > 1 ? (
        <Link
          href={followUpsHref(search, { [section]: Math.min(page.page - 1, page.pageCount) })}
          className={buttonVariants({ variant: "outline" })}
        >
          Previous
        </Link>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Page {page.page} of {page.pageCount}
      </p>
      {page.page < page.pageCount ? (
        <Link href={followUpsHref(search, { [section]: page.page + 1 })} className={buttonVariants({ variant: "outline" })}>
          Next
        </Link>
      ) : null}
    </nav>
  )
}
