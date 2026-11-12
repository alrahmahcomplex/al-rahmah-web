import { KeyValueList } from "@/components/kit"

// Read-only rows (lead-rows.ts) as a kit key-value list.
export function Details({ rows }: { rows: [string, string][] }) {
  return <KeyValueList items={rows.map(([key, value]) => ({ key, value }))} />
}
