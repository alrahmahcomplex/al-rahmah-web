import { Card, ListRow, Tag } from "@/components/kit"
import type { RoleSummary } from "@/lib/services/staff-admin"

import { NewRoleForm } from "./new-role-form"
import { managesRole, type Viewer } from "./view"

// Every role, with how many active staff hold it where the viewer manages
// that role's staff. Selecting one opens it in the pane beside the rail.
// Only the Super Admin gets New role (#241).
export function RoleRail({
  roles,
  selectedId,
  yourRoleId,
  viewer,
}: {
  roles: RoleSummary[]
  selectedId: string
  yourRoleId: string | null
  viewer: Viewer
}) {
  return (
    <Card className="ro-rail">
      <nav aria-label="Roles">
        <h2 className="kit-sec-title">Roles</h2>
        {roles.map((role) => {
          const manages = managesRole(viewer, role.id)
          return (
            <ListRow
              key={role.id}
              href={`/staff/roles?role=${role.id}`}
              current={role.id === selectedId}
              title={role.name}
              caption={role.id === yourRoleId ? "Your role" : undefined}
              trailing={
                role.retired || manages ? (
                  <>
                    {role.retired && <Tag tone="line">Retired</Tag>}
                    {manages && (
                      <span role="img" aria-label={`${role.activeHolders} active`}>
                        <Tag tone="line">{role.activeHolders}</Tag>
                      </span>
                    )}
                  </>
                ) : undefined
              }
            />
          )
        })}
        {viewer.superAdmin && <NewRoleForm />}
      </nav>
    </Card>
  )
}
