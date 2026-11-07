import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { getStaffAdminHistory, getStaffAndRoles } from "@/lib/services/staff-admin"
import { managesStaff } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { History } from "./history"
import { RolePane } from "./role-pane"
import { RoleRail } from "./role-rail"
import { managesRole, roleView, type Viewer } from "./view"

export const metadata: Metadata = {
  title: "Staff and roles · Al-Rahmah Complex",
}

export default async function StaffAndRolesPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const staff = await requireStaff()
  // The Super Admin, and holders of a role that manages other roles' staff (#241).
  if (!managesStaff(staff)) forbidden()
  const viewer: Viewer = { id: staff.id, superAdmin: staff.superAdmin, managedRoleIds: staff.managedRoleIds }

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
  // Someone who manages staff opens on the first role they manage; the Super
  // Admin, whose own role is never listed, on the first role.
  const firstManaged = overview.data.roles.find((r) => !r.retired && managesRole(viewer, r.id))?.id
  const selectedId =
    [requested, firstManaged, yourRoleId, overview.data.roles[0]?.id].find(
      (id) => id && overview.data.roles.some((r) => r.id === id),
    ) ?? ""
  const role = roleView(overview.data, selectedId, viewer)
  // The history is the Super Admin's alone (#237).
  const history = staff.permissions.includes("audit.view") ? await getStaffAdminHistory(supabase, overview.data) : null

  return (
    <div className="flex flex-col gap-4">
      {heading}
      <div className="grid items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <RoleRail roles={overview.data.roles} selectedId={selectedId} yourRoleId={yourRoleId ?? null} viewer={viewer} />
        {role && (
          <RolePane key={role.id} role={role} permissions={overview.data.permissions}>
            {history && <History result={history} />}
          </RolePane>
        )}
      </div>
    </div>
  )
}
