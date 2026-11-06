"use client"

import { LayoutGridIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import { signOut } from "../actions"
import { groupNav } from "../navigation"
import { COUNT_PILL, type ShellItem, type ShellPerson } from "./staff-shell"

// The tabs along the bottom of a phone, in this order, each only when the
// staff member may see it. Everything else is behind More.
const TABS = ["/staff", "/staff/check-in", "/staff/leads"]

// A phone's navigation: the tab bar, and the sheet More opens with the rest of
// the entries and Sign out.
export function PhoneNav({ items, current, person }: { items: ShellItem[]; current: string | undefined; person: ShellPerson }) {
  const [open, setOpen] = useState(false)
  const tabs = TABS.map((href) => items.find((item) => item.href === href)).filter((item) => item !== undefined)
  const rest = items.filter((item) => !tabs.includes(item))
  const moreIsCurrent = rest.some((item) => item.href === current)

  return (
    <>
      <nav
        aria-label="Staff"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid auto-cols-fr grid-flow-col">
          {tabs.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.href === current ? "page" : undefined}
                className={cn(tabClass, item.href === current ? "text-blue-600" : "text-slate-500")}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              className={cn(tabClass, "w-full", moreIsCurrent ? "text-blue-600" : "text-slate-500")}
            >
              <LayoutGridIcon aria-hidden="true" />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="pb-2">
            <SheetTitle>More</SheetTitle>
            <SheetDescription>
              {person.name} · {person.roleName}
            </SheetDescription>
          </SheetHeader>
          <nav aria-label="More" className="px-2">
            {groupNav(rest).map((group) => (
              <div key={group.name}>
                <p className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">{group.name}</p>
                <ul>
                  {group.entries.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={item.href === current ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex h-11 items-center gap-3 rounded-lg px-2 text-sm font-medium [&_svg]:size-[18px] [&_svg]:shrink-0",
                          item.href === current ? "bg-blue-50 text-blue-600" : "text-slate-700 active:bg-slate-100",
                        )}
                      >
                        <span className={cn("flex", item.href === current ? "text-blue-600" : "text-slate-500")}>{item.icon}</span>
                        {item.label}
                        {item.count !== undefined && item.count.count > 0 && (
                          <span className={cn(COUNT_PILL, "ml-auto h-5 min-w-5 px-1.5 text-[11px]")}>
                            <span className="sr-only">, </span>
                            {item.count.count}
                            <span className="sr-only"> {item.count.label}</span>
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <SheetFooter className="mt-4 border-t border-slate-200">
            <form action={signOut}>
              <Button type="submit" variant="outline" className="w-full">
                Sign out
              </Button>
            </form>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

const tabClass = "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium [&_svg]:size-[22px]"
