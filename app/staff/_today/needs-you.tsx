import {
  BadgePercentIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  MegaphoneIcon,
  PhoneIcon,
  RepeatIcon,
  RotateCcwIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"

import { cn } from "@/lib/utils"

import type { QueueRow, QueueRowKey } from "./queue"

const ICONS: Record<QueueRowKey, LucideIcon> = {
  overdue: PhoneIcon,
  interviews: ClipboardCheckIcon,
  reApplications: RepeatIcon,
  results: SendIcon,
  agents: MegaphoneIcon,
  discounts: BadgePercentIcon,
  reopenings: RotateCcwIcon,
}

// The work waiting for the signed-in staff member, each row a link to the
// screen it is done on. With nothing waiting, one calm line.
export function NeedsYou({ rows, unavailable }: { rows: QueueRow[]; unavailable: boolean }) {
  return (
    <section aria-labelledby="needs-you-heading" className="flex min-w-0 flex-col gap-2.5">
      <h2 id="needs-you-heading" className="text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
        Needs you today
      </h2>
      {rows.length === 0 && unavailable ? (
        <p className="rounded-xl bg-card px-4 py-3 text-sm text-muted-foreground ring-1 ring-foreground/10">
          What is waiting could not be counted. Try again in a moment.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl bg-card px-4 py-3 text-sm text-slate-600 ring-1 ring-foreground/10" data-testid="today-empty">
          Nothing is waiting. Families you check in will appear here.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          {rows.map((row) => {
            const Icon = ICONS[row.key]
            return (
              <li key={row.key}>
                <Link
                  href={row.href}
                  data-testid={`today-${row.key}`}
                  className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-slate-50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg",
                      row.key === "overdue" ? "bg-orange-50 text-orange-600" : "bg-slate-100 text-slate-600",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-900">{row.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
                  </span>
                  <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {unavailable && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">Some of what is waiting could not be counted. Try again in a moment.</p>
      )}
    </section>
  )
}
