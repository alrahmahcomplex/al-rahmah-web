import Image from "next/image"
import Link from "next/link"

import { Button } from "@/components/ui/button"

import { signOut } from "./actions"
import { NavLink } from "./nav-link"
import { navFor } from "./navigation"
import { requireStaff } from "./session"

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff()
  const nav = navFor(staff.permissions)

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link href="/staff" className="shrink-0">
            <Image src="/Al-Rahmah_Official_Logo.svg" alt="Al-Rahmah Logo" width={40} height={40} />
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="min-w-0 text-right text-sm leading-tight">
              <p className="truncate font-medium text-slate-900">{staff.name}</p>
              <p className="truncate text-slate-500">{staff.roleName}</p>
            </div>
            <form action={signOut}>
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </div>
        </div>
        {nav.length > 0 && (
          <nav aria-label="Staff" className="mx-auto max-w-5xl overflow-x-auto px-2 pb-2">
            <ul className="flex gap-1">
              {nav.map((entry) => (
                <li key={entry.href}>
                  <NavLink href={entry.href}>{entry.label}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}
