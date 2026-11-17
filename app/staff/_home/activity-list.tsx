"use client"

import { useEffect, useRef, useState, useTransition } from "react"

import { Icon } from "@/components/icons"
import { Button, ButtonLink, Card, KeyValueList, Note, Pagination, Sheet, type KeyValueItem } from "@/components/kit"

import type { ActivityView } from "./activity"
import { loadActivityPage } from "./activity-actions"
import type { ActivityScreenPage } from "./activity-data"
import "./activity.css"

const LOST_REQUEST = "The Activity log could not be loaded. Check your connection and try again."

const whoLine = (row: ActivityView) => (row.about ? `${row.who} · ${row.about}` : row.who)
// v39: a clock time reads "Today 08:05" in the sheet; "All day", "Today" and dates read as they are.
const sheetTime = (time: string) => (/^\d\d:\d\d$/.test(time) ? `Today ${time}` : time)

/**
 * Home's Activity log (#406, prototype v39): today's events and what still
 * waits, ten rows a page, oldest first. Pressing a row opens its side sheet;
 * the outlined button takes the next step for staff who may.
 */
export function ActivityList({ first }: { first: ActivityScreenPage }) {
  const [shown, setShown] = useState(first)
  const [from, setFrom] = useState(first)
  const [open, setOpen] = useState<ActivityView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Only the newest page asked for, from the first page now on screen, may
  // replace the rows: an older answer that arrives late is dropped.
  const asked = useRef(0)
  const firstNow = useRef(first)
  useEffect(() => {
    firstNow.current = first
  }, [first])

  // Home read the log again (an action revalidated it, or the page was
  // refreshed): show the new first page, as a reload would.
  if (from !== first) {
    setFrom(first)
    setShown(first)
    setOpen(null)
    setError(null)
  }

  function goTo(page: number) {
    setError(null)
    const ticket = ++asked.current
    const base = first
    const current = () => ticket === asked.current && firstNow.current === base
    startTransition(async () => {
      try {
        let outcome = await loadActivityPage(page)
        // The log shrank since this page was drawn: go to its new last page.
        if (current() && outcome.status === "ok" && outcome.page.total > 0 && outcome.page.page > outcome.page.pageCount) {
          outcome = await loadActivityPage(outcome.page.pageCount)
        }
        if (!current()) return
        if (outcome.status === "ok") setShown(outcome.page)
        else setError(outcome.message)
      } catch {
        if (current()) setError(LOST_REQUEST)
      }
    })
  }

  // Nothing is left in the log: the card goes, as it does on a day with none.
  if (shown.total === 0) return null

  const facts = (row: ActivityView): KeyValueItem[] => [
    { key: "Who", value: row.who },
    { key: "About", value: row.about ?? "-" },
    { key: "What happened", value: row.details },
    ...(row.recordedBy ? [{ key: "Recorded by", value: row.recordedBy }] : []),
  ]

  return (
    <Card title="Activity log" caption="Everything that happened today and what to do next. Press a row for the details." className="hm-al">
      <div className="al-cols" aria-hidden="true">
        <span>Time</span>
        <span />
        <span>Task</span>
        <span>Details</span>
        <span>Next</span>
      </div>
      <ol className="al" aria-busy={pending || undefined}>
        {shown.rows.map((row) => (
          <li key={row.key} className="al-r" onClick={() => setOpen(row)}>
            <span className="al-t">{row.time}</span>
            <span className="al-i">
              <span className="al-ico">
                <Icon name={row.icon} size={18} />
              </span>
            </span>
            <button
              type="button"
              className="al-n"
              aria-label={`${row.task}, ${whoLine(row)}. Open the details`}
              onClick={(event) => {
                event.stopPropagation()
                setOpen(row)
              }}
            >
              <b>{row.task}</b>
              <small>{whoLine(row)}</small>
            </button>
            <span className="al-d">{row.details}</span>
            <span className="al-a">
              {row.action && (
                <ButtonLink href={row.action.href} variant="ghost" size="small" onClick={(event) => event.stopPropagation()}>
                  {row.action.label}
                </ButtonLink>
              )}
            </span>
          </li>
        ))}
      </ol>
      <Pagination
        label="Activity pages"
        page={shown.page}
        pageCount={shown.pageCount}
        onPage={goTo}
        previousLabel="Previous page"
        nextLabel="Next page"
        className="al-pg"
      />
      {error && (
        <Note tone="bad" role="alert">
          {error}
        </Note>
      )}
      <Sheet
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null)
        }}
        placement="side"
        title={open?.task ?? ""}
        hint={open ? `${sheetTime(open.time)} · ${whoLine(open)}` : undefined}
        closeLabel="Close"
        foot={
          open && (
            <>
              {open.action && (
                <ButtonLink href={open.action.href} size="wide" chevron>
                  {open.action.label}
                </ButtonLink>
              )}
              <Button variant="ghost" size="wide" onClick={() => setOpen(null)}>
                Close
              </Button>
            </>
          )
        }
      >
        {open && (
          <>
            <KeyValueList items={facts(open)} />
            {open.note && (
              <Note tone={open.note.tone} icon={open.note.tone === "wait" ? "alert" : "info"} className="al-sheet-note">
                {open.note.text}
              </Note>
            )}
          </>
        )}
      </Sheet>
    </Card>
  )
}
