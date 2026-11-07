"use client"

import { PanelLeftIcon } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { currentNavHref, groupNav } from "../navigation"
import { SIDEBAR_COOKIE_MAX_AGE, SIDEBAR_RAIL_COOKIE } from "../shell-cookies"
import { AccountMenu } from "./account-menu"
import { HEADER_ACTIONS_ID } from "./header-actions"
import { CountPill } from "./count-pill"
import type { ShellItem, ShellPerson } from "./items"
import { PhoneNav } from "./phone-nav"

export type { ShellItem, ShellPerson } from "./items"

// The chrome around every staff page: the sidebar from `md` up, folding to a
// 72px rail; the slim top bar; and on a phone the bottom tab bar with its
// More sheet. The rail is kept in a cookie the browser writes itself, which
// the layout reads, so a reload paints it folded from the start.
export function StaffShell({
  items,
  initialCollapsed,
  person,
  children,
}: {
  items: ShellItem[]
  initialCollapsed: boolean
  person: ShellPerson
  children: ReactNode
}) {
  const pathname = usePathname()
  const current = currentNavHref(pathname, items.map((item) => item.href))
  const title = items.find((item) => item.href === current)?.label ?? "Staff"
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${SIDEBAR_RAIL_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`
  }

  return (
    <div data-staff-shell className="flex min-h-screen bg-white">
      <TooltipProvider delay={300}>
        <aside
          id="staff-sidebar"
          aria-label="Sidebar"
          data-collapsed={collapsed ? "true" : undefined}
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-3.5 md:flex",
            collapsed ? "w-18" : "w-60",
          )}
        >
          <Link
            href="/staff"
            className={cn(
              "flex items-center gap-2.5 rounded-lg pt-1 pb-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              collapsed ? "justify-center" : "px-2",
            )}
          >
            <Image src="/Al-Rahmah_Official_Logo.svg" alt="" width={36} height={28} className="h-7 w-9 shrink-0" />
            <span className={cn("min-w-0 leading-tight", collapsed && "sr-only")}>
              <span className="block truncate text-sm font-semibold text-slate-900">Al-Rahmah Complex</span>
              <span className="block text-xs text-slate-500">Admissions</span>
            </span>
          </Link>
          <nav aria-label="Staff" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {groupNav(items).map((group) => (
              <div key={group.name} className={collapsed ? "not-first:mt-4" : "not-first:mt-2.5"}>
                <p
                  className={cn(
                    "px-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase",
                    collapsed && "sr-only",
                  )}
                >
                  {group.name}
                </p>
                <ul className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
                  {group.entries.map((item) => (
                    <li key={item.href}>
                      <SidebarLink item={item} current={item.href === current} collapsed={collapsed} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <AccountMenu person={person} collapsed={collapsed} />
        </aside>
      </TooltipProvider>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden text-slate-600 md:inline-flex"
            aria-controls="staff-sidebar"
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <PanelLeftIcon />
            <span className="sr-only">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
          </Button>
          <Link href="/staff" className="shrink-0 md:hidden">
            <Image src="/Al-Rahmah_Official_Logo.svg" alt="Al-Rahmah Logo" width={31} height={24} className="h-6 w-8" />
          </Link>
          <p className="truncate text-sm font-medium text-slate-900">{title}</p>
          {/* A page puts its own action here through HeaderActions. */}
          <div id={HEADER_ACTIONS_ID} className="ml-auto flex shrink-0 items-center gap-2" />
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-8 pb-28 md:pb-8">{children}</main>
      </div>
      <PhoneNav items={items} current={current} person={person} />
    </div>
  )
}

function SidebarLink({ item, current, collapsed }: { item: ShellItem; current: boolean; collapsed: boolean }) {
  const link = (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "relative flex h-8 items-center gap-2.5 rounded-lg text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        collapsed ? "w-10 justify-center" : "px-2.5",
        current ? "bg-blue-50 text-blue-600" : "text-slate-700 hover:bg-slate-100",
      )}
    >
      <span className={cn("flex shrink-0 [&_svg]:size-[18px]", current ? "text-blue-600" : "text-slate-500")}>{item.icon}</span>
      <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
      {item.count !== undefined && item.count.count > 0 && (
        <CountPill
          count={item.count}
          className={collapsed ? "absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]" : "ml-auto h-5 min-w-5 px-1.5 text-[11px]"}
        />
      )}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
