"use client"

import { EllipsisIcon, LogOutIcon } from "lucide-react"
import { useTransition } from "react"

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

import { signOut } from "../actions"
import type { ShellPerson } from "./staff-shell"

// The sidebar's foot: who is signed in, opening the menu with Sign out.
export function AccountMenu({ person, collapsed }: { person: ShellPerson; collapsed: boolean }) {
  const [, startTransition] = useTransition()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "mt-auto flex w-full items-center gap-2.5 border-t border-slate-200 pt-3 text-left outline-none hover:bg-slate-100 focus-visible:ring-3 focus-visible:ring-ring/50",
          collapsed ? "justify-center" : "rounded-b-lg px-2.5 pb-1",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white"
        >
          {initials(person.name)}
        </span>
        <span className={cn("min-w-0 flex-1 leading-tight", collapsed && "sr-only")}>
          <span className="sr-only">Account menu, </span>
          <span className="block truncate text-[13px] font-semibold text-slate-900">{person.name}</span>
          <span className="block truncate text-xs text-slate-500">{person.roleName}</span>
        </span>
        {!collapsed && <EllipsisIcon aria-hidden="true" className="size-4 shrink-0 text-slate-500" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-56">
        <DropdownMenuItem onClick={() => startTransition(() => signOut())}>
          <LogOutIcon aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Up to two initials: "Test Admissions" is TA.
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("")
}
