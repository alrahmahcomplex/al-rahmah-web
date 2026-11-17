import type { Metadata } from "next"
import Link from "next/link"

import { ButtonLink, Card, EmptyState, ListRow, Note, PageHeader, pageTitle, Pagination, StatusChip, Tag } from "@/components/kit"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getFollowUpQueue, type FollowUpQueueItem, type FollowUpQueuePage, type FollowUpQueueSection } from "@/lib/services/follow-ups"
import { createClient } from "@/utils/supabase/server"

import { leadTabHref } from "../applicants/[id]/tabs"
import { displayPhone } from "../re-applications/format"
import StaffForbidden from "../forbidden"
import { requireStaff } from "../session"
import { followUpCount, lastContactText, rowDue, splitToday } from "./queue-format"
import { followUpsHref, parseFollowUpSearch, type FollowUpSearch } from "./search-params"
import "./follow-ups.css"

export const metadata: Metadata = {
  title: pageTitle("Follow-ups"),
}

// The follow-up queue: Overdue, oldest first, then Upcoming, with today's
// follow-ups under Today and later ones nearest first. Each section pages 50
// rows at a time. A row opens the lead's Follow-ups panel, where staff who
// may record follow-ups act; the queue itself has no actions. Drawn in the
// new shell (#328).
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("leads.view")) return <StaffForbidden />

  const search = parseFollowUpSearch(await searchParams)
  const supabase = await createClient()
  const [overdue, upcoming] = await Promise.all([
    getFollowUpQueue(supabase, { section: "overdue", page: search.overdue }),
    getFollowUpQueue(supabase, { section: "upcoming", page: search.upcoming }),
  ])
  const today = tanzaniaToday()

  return (
    <>
      <PageHeader title="Follow-ups" />
      <div className="fu-stack">
        <Section section="overdue" title="Overdue" result={overdue} search={search}>
          {(page) =>
            page.items.length === 0 ? (
              <EmptyState illustration="done" title="No follow-ups are overdue." />
            ) : (
              <Rows items={page.items} today={today} label="Overdue follow-ups" />
            )
          }
        </Section>

        <Section section="upcoming" title="Upcoming" result={upcoming} search={search}>
          {(page) => {
            if (page.items.length === 0) {
              return (
                <EmptyState illustration="done" title="No follow-ups are coming up." />
              )
            }
            const { today: dueToday, later } = splitToday(page.items, today)
            return (
              <>
                {dueToday.length > 0 && (
                  <div className="fu-group">
                    <h3 id="follow-ups-today" className="kit-sec-title">
                      Today
                    </h3>
                    <Rows items={dueToday} today={today} labelledBy="follow-ups-today" />
                  </div>
                )}
                {later.length > 0 && (
                  <div className="fu-group">
                    <h3 id="follow-ups-later" className="kit-sec-title">
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
    </>
  )
}

// One section's card. Its title is the h2; how many it holds is written in
// words under it (The One Pip Rule), not as a badge. A page past the end
// (rows moved since it was opened) says so and links back to the last page;
// `children` draws only a page with rows, or the empty section.
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
  return (
    <Card
      title={title}
      titleId={`follow-ups-${section}`}
      caption={result.ok && result.data.total > 0 ? followUpCount(result.data.total) : undefined}
    >
      {!result.ok ? (
        <Note tone="bad" role="alert">
          {title} follow-ups could not be loaded. Try again in a moment.
        </Note>
      ) : result.data.items.length === 0 && result.data.total > 0 ? (
        <EmptyState
          title="This page is past the end of the list."
          action={
            <ButtonLink href={followUpsHref(search, { [section]: result.data.pageCount })} variant="ghost">
              Previous page
            </ButtonLink>
          }
        />
      ) : (
        <>
          {children(result.data)}
          <Pagination
            className="fu-pages"
            label={`${title} pages`}
            page={result.data.page}
            pageCount={result.data.pageCount}
            href={(each) => followUpsHref(search, { [section]: each })}
            previousLabel="Previous page"
            nextLabel="Next page"
            pageLabel={(each) => `Page ${each}`}
          />
        </>
      )}
    </Card>
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
    <ul aria-label={label} aria-labelledby={labelledBy} className="fu-list">
      {items.map((item) => (
        // A lead that needs a follow-up date has no follow-up yet, and shows
        // at most once.
        <Row key={`${item.kind}:${item.followUpId ?? item.lead.id}`} item={item} today={today} />
      ))}
    </ul>
  )
}

// One follow-up, or a reopened lead that needs a follow-up date, dated from
// its approval. The whole row opens the lead's Follow-ups panel (the name's
// link covers it); the phone sits above that link so a tap on it calls the
// family.
function Row({ item, today }: { item: FollowUpQueueItem; today: string }) {
  const due = rowDue(item, today)
  return (
    <li className="fu-row">
      <ListRow
        icon={item.kind === "needs_date" ? "reopen" : "followups"}
        title={
          <span className="fu-title">
            <Link href={leadTabHref(item.lead.id, "follow-ups", "lead-follow-ups")} className="fu-open">
              {item.lead.studentName}
            </Link>
            <span className="fu-number">{item.lead.admissionNumber}</span>
            <StatusChip status={item.lead.status} />
          </span>
        }
        caption={
          <>
            <span className="fu-line">
              {item.lead.className} · {item.lead.enrollmentYear}
            </span>
            <span className="fu-line fu-due">
              {item.kind === "needs_date" && <span>Reopened</span>}
              <time dateTime={item.dueOn} className="fu-date">
                {formatDate(item.dueOn)}
              </time>
              <Tag tone={due.overdue ? "bad" : "line"}>{due.text}</Tag>
            </span>
            {item.note && <span className="fu-line fu-note">{item.note}</span>}
            <span className="fu-line">{lastContactText(item.lastContact)}</span>
          </>
        }
        trailing={
          <span className="fu-who">
            <span className="fu-guardian">{item.guardian.name}</span>
            <a href={`tel:${item.guardian.phone}`} className="fu-phone">
              {displayPhone(item.guardian.phone)}
            </a>
          </span>
        }
      />
    </li>
  )
}
