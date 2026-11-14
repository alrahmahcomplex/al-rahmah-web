import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { Note, PageHeader, pageTitle } from "@/components/kit"
import { getStaffAdminHistory, getStaffAndRoles } from "@/lib/services/staff-admin"
import { managesStaff } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { History } from "./history"
import { RolePane } from "./role-pane"
import { RoleRail } from "./role-rail"
import { managesRole, roleView, type Viewer } from "./view"
import "./roles.css"

export const metadata: Metadata = {
  title: pageTitle("Staff and roles"),
}

export default async function StaffAndRolesPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const staff = await requireStaff()
  // The Super Admin, and holders of a role that manages other roles' staff (#241).
  if (!managesStaff(staff)) forbidden()
  const viewer: Viewer = { id: staff.id, superAdmin: staff.superAdmin, managedRoleIds: staff.managedRoleIds }

  const supabase = await createClient()
  const overview = await getStaffAndRoles(supabase)
  const heading = <PageHeader title="Staff and roles" />
  if (!overview.ok) {
    return (
      <>
        {heading}
        <Note tone="bad" role="alert">
          Staff and roles could not be loaded. Try again in a moment.
        </Note>
      </>
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
    <>
      {heading}
      <div className="ro-grid">
        <RoleRail roles={overview.data.roles} selectedId={selectedId} yourRoleId={yourRoleId ?? null} viewer={viewer} />
        {role && (
          <RolePane key={role.id} role={role} permissions={overview.data.permissions}>
            {history && <History result={history} />}
          </RolePane>
        )}
      </div>
    </>
  )
}
