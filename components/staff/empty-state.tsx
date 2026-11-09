import type { LucideIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

import { cn } from "@/lib/utils"

// What a list or search shows when it has nothing: one icon in a soft indigo
// disc, the words saying why, and at most one way forward. It takes the place
// of the table, in the same outline, so the page keeps its shape.
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
  ...props
}: {
  icon: LucideIcon
  title: ReactNode
  body?: ReactNode
  action?: ReactNode
} & Omit<ComponentProps<"div">, "title" | "children">) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center rounded-lg px-6 py-10 text-center ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full bg-blue-50 text-blue-600"
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <p className="mt-3 text-[15px]/5 font-semibold tracking-tight text-slate-900">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
