import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import styles from "./success-mark.module.css"

// What a sheet or dialog shows once its save has landed, and the import's Done
// step: a check that draws itself once in a soft green disc, a title and one
// line. It is a status, so a screen reader hears it arrive.
export function SuccessMark({ title, body, className }: { title: ReactNode; body?: ReactNode; className?: string }) {
  return (
    <div role="status" data-slot="success-mark" className={cn("flex items-start gap-3", styles.mark, className)}>
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} className={styles.check} />
        </svg>
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
        <p className="text-[15px]/5 font-semibold tracking-tight text-slate-900">{title}</p>
        {body && <p className="text-sm text-muted-foreground">{body}</p>}
      </div>
    </div>
  )
}
