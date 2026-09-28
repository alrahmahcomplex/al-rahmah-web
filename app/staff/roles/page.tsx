import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { getStaffAdminHistory, getStaffAndRoles } from "@/lib/services/staff-admin"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { History } from "./history"
import { RolePane } from "./role-pane"
import { RoleRail } from "./role-rail"
import { roleView } from "./view"

export const metadata: Metadata = {
  title: "Staff and roles · Al-Rahmah Complex",
}

export default async function StaffAndRolesPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("staff.administer")) forbidden()

  const supabase = await createClient()
  const overview = await getStaffAndRoles(supabase)
  const heading = <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Staff and roles</h1>
  if (!overview.ok) {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        <Alert variant="destructive">
          <AlertDescription>Staff and roles could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const { role: requested } = await searchParams
  const yourRoleId = overview.data.staff.find((s) => s.id === staff.id)?.roleId
  const selectedId =
    [requested, yourRoleId, overview.data.roles[0]?.id].find((id) => id && overview.data.roles.some((r) => r.id === id)) ??
    ""
  const role = roleView(overview.data, selectedId, staff.id)
  const history = await getStaffAdminHistory(supabase, overview.data)

  return (
    <div className="flex flex-col gap-4">
      {heading}
      <div className="grid items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <RoleRail roles={overview.data.roles} selectedId={selectedId} yourRoleId={yourRoleId ?? null} />
        {role && (
          <RolePane key={role.id} role={role} permissions={overview.data.permissions}>
            <History result={history} />
          </RolePane>
        )}
      </div>
    </div>
  )
}
