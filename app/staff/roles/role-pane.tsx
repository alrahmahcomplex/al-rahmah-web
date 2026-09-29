"use client"

import { ChevronDownIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react"
import { useId, useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ADMINISTER_LABEL, type PermissionOption } from "@/lib/services/staff-admin"
import { cn } from "@/lib/utils"

import {
  correctStaffMemberName,
  deactivateStaffMember,
  moveStaffMember,
  reactivateStaffMember,
  renameRoleTo,
  retireRoleNow,
  setPermission,
  type ChangeOutcome,
} from "./actions"
import type { PersonView, RoleOption, RoleView } from "./view"

type Run = (change: () => Promise<ChangeOutcome>) => void

// A change that takes "Administer staff and roles" from a fellow Manager, or
// retires a role, waits here until the person confirms it.
type PendingConfirmation = { title: string; description: string; action: string; change: () => Promise<ChangeOutcome> }

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h3>
}

export function RolePane({
  role,
  permissions,
  children,
}: {
  role: RoleView
  permissions: PermissionOption[]
  children: React.ReactNode
}) {
  const [outcome, setOutcome] = useState<ChangeOutcome | null>(null)
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [pending, startTransition] = useTransition()
  const subtitleId = useId()
  const retireReasonId = useId()
  const administerNoteId = useId()
  const permissionIdPrefix = useId()

  const run: Run = (change) => {
    startTransition(async () => {
      setOutcome(await change())
    })
  }

  return (
    <section
      aria-labelledby="role-heading"
      className="flex min-w-0 flex-col gap-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      {outcome && (
        <Alert variant={outcome.ok ? "default" : "destructive"} role={outcome.ok ? "status" : "alert"}>
          {outcome.ok ? <CircleCheckIcon /> : <CircleAlertIcon />}
          <AlertDescription className={cn(outcome.ok && "text-foreground")}>{outcome.message}</AlertDescription>
        </Alert>
      )}

      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <h2 id="role-heading" className={cn("text-lg font-semibold break-words", role.retired && "text-muted-foreground")}>
            {role.name}
          </h2>
          <p id={subtitleId} className="text-sm text-muted-foreground">
            {role.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !role.editable}
            aria-describedby={role.editable ? undefined : subtitleId}
            onClick={() => setRenaming(true)}
          >
            Rename
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || !role.editable || role.retireBlocked !== null}
            aria-describedby={role.editable ? (role.retireBlocked ? retireReasonId : undefined) : subtitleId}
            onClick={() =>
              setConfirmation({
                title: `Retire ${role.name}?`,
                description: `Nobody can be given ${role.name} once it is retired, and it can't be brought back. It stays in history, with the people who held it.`,
                action: "Retire role",
                change: () => retireRoleNow(role.id),
              })
            }
          >
            Retire role
          </Button>
        </div>
        {role.retireBlocked && (
          <p id={retireReasonId} className="basis-full text-xs text-muted-foreground">
            {role.retireBlocked}
          </p>
        )}
      </header>

      <fieldset aria-describedby={role.editable ? undefined : subtitleId}>
        <legend className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          What this role can do
        </legend>
        <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {permissions.map((permission) => {
            const held = role.permissions.includes(permission.name)
            const administer = permission.name === "staff.administer"
            const checkboxId = `${permissionIdPrefix}-${permission.name}`
            return (
              <li key={permission.name} className="flex items-start gap-2 py-1 text-sm">
                <Checkbox
                  id={checkboxId}
                  // Base UI marks a disabled checkbox with data-disabled, not :disabled.
                  className="mt-0.5 data-disabled:cursor-not-allowed data-disabled:opacity-50"
                  checked={held}
                  disabled={pending || !role.editable || administer}
                  aria-describedby={administer ? administerNoteId : undefined}
                  onCheckedChange={(granted) =>
                    run(async () => {
                      const outcome = await setPermission(role.id, permission.name, granted)
                      if (!outcome.ok) return outcome
                      return {
                        ok: true,
                        message: granted
                          ? `${role.name} can now: ${permission.label}.`
                          : `${role.name} can no longer: ${permission.label}.`,
                      }
                    })
                  }
                />
                <span className="flex flex-col gap-0.5">
                  <Label
                    htmlFor={checkboxId}
                    className={cn("font-normal", !held && "text-muted-foreground")}
                  >
                    {permission.label}
                  </Label>
                  {administer && (
                    <span id={administerNoteId} className="text-xs text-muted-foreground">
                      Only a reviewed update to the system can give or take this.
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </fieldset>

      <div>
        <SectionHeading>People in this role</SectionHeading>
        {role.people.length === 0 ? (
          <p className="rounded-lg border px-3 py-3 text-sm text-muted-foreground">Nobody holds this role.</p>
        ) : (
          <ul aria-label={`People in ${role.name}`} className="divide-y rounded-lg border">
            {role.people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                roleName={role.name}
                pending={pending}
                run={run}
                report={setOutcome}
                confirm={setConfirmation}
              />
            ))}
          </ul>
        )}
      </div>

      {children}

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={`Rename ${role.name}`}
        description="The new name shows everywhere, history included. Everyone in the role keeps what it can do."
        label="Role name"
        defaultValue={role.name}
        submit="Save name"
        save={(name) => renameRoleTo(role.id, name)}
        onSaved={setOutcome}
      />

      <AlertDialog open={confirmation !== null} onOpenChange={(open) => !open && setConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmation) run(confirmation.change)
                setConfirmation(null)
              }}
            >
              {confirmation?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function PersonRow({
  person,
  roleName,
  pending,
  run,
  report,
  confirm,
}: {
  person: PersonView
  roleName: string
  pending: boolean
  run: Run
  report: (outcome: ChangeOutcome) => void
  confirm: (confirmation: PendingConfirmation) => void
}) {
  const reasonsId = useId()
  const [renaming, setRenaming] = useState(false)

  const move = (target: RoleOption) => {
    const change = () => moveStaffMember(person.id, target.id)
    if (person.administers && !target.administers) {
      confirm({
        title: `Move ${person.name} to ${target.name}?`,
        description: `${person.name} will lose "${ADMINISTER_LABEL}" and can no longer manage staff or roles. The change applies on their next click.`,
        action: "Move",
        change,
      })
    } else {
      run(change)
    }
  }

  const deactivate = () => {
    const change = () => deactivateStaffMember(person.id)
    if (person.administers) {
      confirm({
        title: `Deactivate ${person.name}?`,
        description: `${person.name} will lose access to the staff side on their next click, including "${ADMINISTER_LABEL}". Their name stays on everything they recorded.`,
        action: "Deactivate",
        change,
      })
    } else {
      run(change)
    }
  }

  const reasons = [
    person.moveBlocked,
    person.active ? person.deactivateBlocked : person.reactivateBlocked,
  ].filter((reason): reason is string => reason !== null)
  const describedBy = reasons.length > 0 ? reasonsId : undefined

  return (
    <li aria-label={person.name} className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className={cn("truncate text-sm font-medium", !person.active && "text-muted-foreground")}>
            {person.name}
            {person.isYou && <span className="font-normal text-muted-foreground"> (you)</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{person.email}</p>
        </div>
        <Badge variant={person.active ? "secondary" : "outline"}>{person.active ? "Active" : "Deactivated"}</Badge>
        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
              disabled={pending || person.moveBlocked !== null}
              aria-describedby={person.moveBlocked ? describedBy : undefined}
            >
              Move to…
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto min-w-44">
              {person.moveTargets.map((target) => (
                <DropdownMenuItem key={target.id} onClick={() => move(target)}>
                  {target.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {person.active ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || person.deactivateBlocked !== null}
              aria-describedby={person.deactivateBlocked ? describedBy : undefined}
              onClick={deactivate}
            >
              Deactivate
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || person.reactivateBlocked !== null}
              aria-describedby={person.reactivateBlocked ? describedBy : undefined}
              onClick={() => run(() => reactivateStaffMember(person.id))}
            >
              Reactivate
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRenaming(true)}>
            Correct name
          </Button>
        </div>
      </div>

      {reasons.length > 0 && (
        <ul id={reasonsId} className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={`Correct ${person.name}'s name`}
        description={`${person.email} · ${roleName}. The corrected name shows everywhere, history included.`}
        label="Full name"
        defaultValue={person.name}
        submit="Save name"
        save={(fullName) => correctStaffMemberName(person.id, fullName)}
        onSaved={report}
      />
    </li>
  )
}

// One text field in a dialog: correcting a person's name, renaming a role.
// It stays open until the save lands. A refusal (a name another role has)
// shows inside it, so the typed name can be fixed in place; a success
// closes it and goes to the pane's callout.
function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  defaultValue,
  submit,
  save,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  label: string
  defaultValue: string
  submit: string
  save: (name: string) => Promise<ChangeOutcome>
  onSaved: (outcome: ChangeOutcome) => void
}) {
  const inputId = useId()
  const errorId = useId()
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const changeOpen = (next: boolean) => {
    if (!next) setError(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            const name = String(new FormData(event.currentTarget).get("name") ?? "")
            startSaving(async () => {
              const outcome = await save(name)
              if (!outcome.ok) {
                setError(outcome.message)
                return
              }
              changeOpen(false)
              onSaved(outcome)
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>{label}</Label>
            <Input
              id={inputId}
              name="name"
              defaultValue={defaultValue}
              required
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
