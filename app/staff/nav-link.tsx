"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

// `count`, when given, is how many Pending items wait there, such as agents to approve.
export function NavLink({ href, count, children }: { href: string; count?: number; children: React.ReactNode }) {
  const pathname = usePathname()
  const current = pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        // Relative, so the count's screen-reader text stays inside the
        // scrolling menu instead of widening the page on a phone.
        "relative inline-flex h-8 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        current && "text-blue-600",
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-semibold text-white">
          <span className="sr-only">, </span>
          {count}
          <span className="sr-only"> Pending</span>
        </span>
      )}
    </Link>
  )
}
