"use client"

import { useState } from "react"

import { ButtonLink, KeyValueList, Section, Sheet, Table, Tag, type TableColumn } from "@/components/kit"

import type { DescribedAuditEntry } from "../_audit-words"

// Four-column Audit table with a side Sheet showing plain-word changes and
// the stored details (#504).
export function AuditTable({ entries }: { entries: readonly DescribedAuditEntry[] }) {
  const [selected, setSelected] = useState<DescribedAuditEntry | null>(null)
  const [open, setOpen] = useState(false)

  const columns: TableColumn<DescribedAuditEntry>[] = [
    {
      header: "Date",
      cell: (entry) => (
        <time dateTime={entry.at} className="au-date">
          {entry.when}
        </time>
      ),
    },
    {
      header: "Actor",
      cell: (entry) => <span className="au-actor">{entry.actor}</span>,
    },
    {
      header: "Event",
      rowHeader: true,
      cell: (entry) => <span className="au-event">{entry.event}</span>,
    },
    {
      header: "Record",
      cell: (entry) => (
        <span className="au-rec">
          <b>{entry.record.title}</b>
          {entry.record.subtitle && <small>{entry.record.subtitle}</small>}
        </span>
      ),
    },
  ]

  return (
    <>
      <Table
        label="Audit entries"
        className="au-table"
        columns={columns}
        rows={[...entries]}
        rowKey={(entry) => String(entry.id)}
        onOpen={(entry) => {
          setSelected(entry)
          setOpen(true)
        }}
        rowLabel={(entry) => `${entry.event}, ${entry.record.title}, by ${entry.actor}, ${entry.when}. Open the details.`}
      />

      <Sheet
        open={open}
        onOpenChange={setOpen}
        placement="side"
        title={selected?.event ?? ""}
        hint={selected ? `${selected.actor} · ${selected.when}` : undefined}
        chips={selected && <Tag tone="line">{selected.areaLabel}</Tag>}
        closeLabel="Close"
        foot={
          selected?.link && (
            <ButtonLink href={selected.link.href} variant="ghost" size="wide">
              {selected.link.label}
            </ButtonLink>
          )
        }
      >
        {selected && (
          <>
            <Section title="Record">
              <KeyValueList
                items={[
                  {
                    key: selected.record.kind,
                    value: selected.record.title,
                    reason: selected.record.subtitle ?? undefined,
                    numeric: true,
                  },
                ]}
              />
            </Section>

            {(selected.changes.length > 0 || selected.unknownCount > 0) && (
              <Section title="What changed">
                {selected.changes.length > 0 && (
                  <KeyValueList
                    items={selected.changes.map((change) => ({
                      key: change.label,
                      value:
                        change.from !== null ? (
                          <>
                            <span className="au-was">{change.from}</span>
                            <span className="au-arrow" aria-label="changed to">
                              →
                            </span>
                            {change.to}
                          </>
                        ) : (
                          change.to
                        ),
                    }))}
                  />
                )}
                {selected.unknownCount > 0 && (
                  <p className="au-more">
                    {selected.unknownCount === 1
                      ? "1 more change, listed under Details."
                      : `${selected.unknownCount} more changes, listed under Details.`}
                  </p>
                )}
              </Section>
            )}

            <Section title="Details">
              <KeyValueList
                items={[
                  { key: "Action", value: selected.details.action, numeric: true },
                  { key: "Table", value: selected.details.table ?? "—", numeric: true },
                  { key: "Row", value: selected.details.rowId ?? "—", numeric: true },
                  ...selected.details.fields.map((field) => ({
                    key: field.field,
                    value: field.from !== null ? `${field.from} → ${field.to}` : field.to,
                    numeric: true,
                  })),
                ]}
              />
            </Section>
          </>
        )}
      </Sheet>
    </>
  )
}
