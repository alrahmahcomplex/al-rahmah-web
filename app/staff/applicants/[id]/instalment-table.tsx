"use client"

import { Table } from "@/components/kit"

export type InstalmentRow = { name: string; due: string; amount: string }

// The School fee's three instalments in the kit table: the name, the due
// date and the amount, already formatted by the server.
export function InstalmentTable({ rows }: { rows: InstalmentRow[] }) {
  return (
    <Table
      label="Instalments"
      rowKey={(row) => row.name}
      rows={rows}
      columns={[
        { header: "Instalment", cell: (row) => row.name },
        { header: "Due", cell: (row) => row.due, align: "end" },
        { header: "Amount (TZS)", cell: (row) => row.amount, align: "end" },
      ]}
    />
  )
}
