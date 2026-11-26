"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { Button, DateField, Field, RoundButton, Select } from "@/components/kit"
import { AUDIT_AREAS, SYSTEM_ACTORS, auditHref, type AuditActor, type AuditFilters } from "@/lib/services/system-audit"

// The five filters of /staff/audit in one row outside the table card (#504):
// From, To, Who, Area, Record, with Apply and the reset RoundButton at the end.
// Preserves GET form submission and URL params (auditFilters/auditHref).
export function AuditFiltersForm({ filters, actors }: { filters: AuditFilters; actors: readonly AuditActor[] }) {
  const router = useRouter()
  const filtersKey = auditHref(filters, 1)
  const [seenKey, setSeenKey] = useState(filtersKey)
  const [cleared, setCleared] = useState(false)
  const [resetNonce, setResetNonce] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (seenKey !== filtersKey) {
    setSeenKey(filtersKey)
    setCleared(false)
  }

  useEffect(() => {
    return () => {
      if (spinTimer.current) clearTimeout(spinTimer.current)
    }
  }, [])

  const shown = cleared ? {} : filters
  const fieldsKey = `${filtersKey}:${resetNonce}`

  function handleClear() {
    if (spinTimer.current) clearTimeout(spinTimer.current)
    setSpinning(false)
    requestAnimationFrame(() => {
      setSpinning(true)
      spinTimer.current = setTimeout(() => setSpinning(false), 560)
    })
    setCleared(true)
    setResetNonce((n) => n + 1)
    if (filtersKey !== "/staff/audit") router.push("/staff/audit")
  }

  return (
    <form method="get" action="/staff/audit" className="au-filters" aria-label="Filter the audit">
      <div key={fieldsKey} className="contents">
        <div className="au-f au-f-date">
          <label htmlFor="audit-from">From</label>
          <DateField id="audit-from" name="from" defaultValue={shown.from ?? ""} />
        </div>
        <div className="au-f au-f-date">
          <label htmlFor="audit-to">To</label>
          <DateField id="audit-to" name="to" defaultValue={shown.to ?? ""} />
        </div>
        <div className="au-f au-f-who">
          <label htmlFor="audit-actor">Who</label>
          <Select
            id="audit-actor"
            name="actor"
            defaultValue={shown.actor ?? ""}
            options={[
              { value: "", label: "Anyone" },
              ...SYSTEM_ACTORS.map((actor) => ({ value: actor.value, label: actor.label })),
              ...actors.map((actor) => ({ value: actor.id, label: actor.name })),
            ]}
          />
        </div>
        <div className="au-f au-f-area">
          <label htmlFor="audit-area">Area</label>
          <Select
            id="audit-area"
            name="area"
            defaultValue={shown.area ?? ""}
            options={[{ value: "", label: "Everything" }, ...AUDIT_AREAS.map((area) => ({ value: area.value, label: area.label }))]}
          />
        </div>
        <div className="au-f au-f-rec">
          <label htmlFor="audit-record">Record</label>
          <Field
            id="audit-record"
            name="record"
            size="compact"
            alignStart
            placeholder="Admission Number or record id"
            defaultValue={shown.record ?? ""}
          />
        </div>
      </div>
      <div className="au-actions">
        <Button type="submit" size="small" className="au-apply">
          Apply
        </Button>
        <RoundButton
          icon="reset"
          label="Clear filters"
          size={40}
          className={spinning ? "au-reset au-spin" : "au-reset"}
          onClick={handleClear}
        />
      </div>
    </form>
  )
}
