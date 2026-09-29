import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import type { RoleSummary } from "@/lib/services/staff-admin"
import { cn } from "@/lib/utils"

import { NewRoleForm } from "./new-role-form"

// Every role, with how many active staff hold it. Selecting one opens it in
// the pane beside the rail. On a phone the rail is a strip that scrolls
// sideways, so the selected role's pane stays in view below it.
export function RoleRail({
  roles,
  selectedId,
  yourRoleId,
}: {
  roles: RoleSummary[]
  selectedId: string
  yourRoleId: string | null
}) {
  return (
    <nav aria-label="Roles" className="min-w-0 rounded-xl bg-card p-2 ring-1 ring-foreground/10">
      <h2 className="px-2 pt-1 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Roles</h2>
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5">
        {roles.map((role) => {
          const selected = role.id === selectedId
          return (
            <li key={role.id} className="shrink-0">
              <Link
                href={`/staff/roles?role=${role.id}`}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium whitespace-nowrap text-foreground hover:bg-muted md:whitespace-normal",
                  selected && "bg-muted text-blue-600",
                  role.retired && "text-muted-foreground",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words">{role.name}</span>
                  {role.id === yourRoleId && (
                    <span className="text-xs font-normal text-muted-foreground">Your role</span>
                  )}
                </span>
                {role.retired && <Badge variant="ghost">Retired</Badge>}
                <Badge variant="secondary" aria-label={`${role.activeHolders} active`}>
                  {role.activeHolders}
                </Badge>
              </Link>
            </li>
          )
        })}
      </ul>
      <NewRoleForm />
    </nav>
  )
}
