"use client"

import type { KeyboardEvent, ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

export type TableColumn<Row> = {
  /** The heading text. */
  header: ReactNode
  /** What the cell shows. */
  cell: (row: Row) => ReactNode
  /** `end` right-aligns and never wraps: money and counts. */
  align?: "start" | "end"
}

export type TableProps<Row> = {
  /** The table's name for a screen reader. */
  label: string
  columns: TableColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  /**
   * Makes each row open something (a sheet, a record). The row is focusable,
   * Enter opens it, and it gets Lavender Chrome on hover. `rowLabel` names it.
   */
  onOpen?: (row: Row) => void
  rowLabel?: (row: Row) => string
  /** A bold total row over a 1.5px Indigo Line, one cell per column. */
  total?: ReactNode[]
  className?: string
}

/**
 * A table inside a card (DESIGN.md, Lists): 14px Geist with tabular figures,
 * 12px Slate Quiet headings, a Lavender Mist line between rows. A wide table
 * scrolls sideways inside its card.
 */
export function Table<Row>({ label, columns, rows, rowKey, onOpen, rowLabel, total, className }: TableProps<Row>) {
  const open = (row: Row) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== "Enter" || event.target !== event.currentTarget) return
    event.preventDefault()
    onOpen?.(row)
  }
  return (
    // A wide table scrolls sideways; when no row takes focus, the scroll area does, so a keyboard can scroll it.
    <div className={cn("kit-tw", className)} role={onOpen ? undefined : "region"} aria-label={onOpen ? undefined : label} tabIndex={onOpen ? undefined : 0}>
      <table className="kit-tbl" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th key={i} scope="col" data-align={column.align === "end" ? "end" : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onOpen ? "kit-tr-open" : undefined}
              tabIndex={onOpen ? 0 : undefined}
              aria-label={onOpen ? rowLabel?.(row) : undefined}
              onClick={onOpen ? () => onOpen(row) : undefined}
              onKeyDown={onOpen ? open(row) : undefined}
            >
              {columns.map((column, i) => (
                <td key={i} data-align={column.align === "end" ? "end" : undefined}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr>
              {total.map((cell, i) => (
                <td key={i} data-align={columns[i]?.align === "end" ? "end" : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
