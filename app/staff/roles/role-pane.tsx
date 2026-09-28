"use client"

import { CheckIcon, ChevronDownIcon, CircleAlertIcon, CircleCheckIcon, MinusIcon } from "lucide-react"
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
  type ChangeOutcome,
} from "./actions"
import type { PersonView, RoleOption, RoleView } from "./view"

type Run = (change: () => Promise<ChangeOutcome>) => void

// A change that takes "Administer staff and roles" from a fellow Manager
// waits here until the person confirms it.
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
  const [pending, startTransition] = useTransition()

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

      <header className="flex flex-col gap-1">
        <h2 id="role-heading" className={cn("text-lg font-semibold", role.retired && "text-muted-foreground")}>
          {role.name}
        </h2>
        <p className="text-sm text-muted-foreground">{role.subtitle}</p>
      </header>

      <div>
        <SectionHeading>What this role can do</SectionHeading>
        <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {permissions.map((permission) => {
            const held = role.permissions.includes(permission.name)
            return (
              <li
                key={permission.name}
                className={cn("flex items-start gap-2 py-0.5 text-sm", !held && "text-muted-foreground")}
              >
                {held ? (
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden />
                ) : (
                  <MinusIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                <span>
                  {permission.label}
                  <span className="sr-only">{held ? " (included)" : " (not included)"}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>

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
                confirm={setConfirmation}
              />
            ))}
          </ul>
        )}
      </div>

      {children}

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
  confirm,
}: {
  person: PersonView
  roleName: string
  pending: boolean
  run: Run
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

      <CorrectNameDialog
        open={renaming}
        onOpenChange={setRenaming}
        person={person}
        roleName={roleName}
        onSave={(fullName) => run(() => correctStaffMemberName(person.id, fullName))}
      />
    </li>
  )
}

function CorrectNameDialog({
  open,
  onOpenChange,
  person,
  roleName,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  person: PersonView
  roleName: string
  onSave: (fullName: string) => void
}) {
  const inputId = useId()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(String(new FormData(event.currentTarget).get("full_name") ?? ""))
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>Correct {person.name}&apos;s name</DialogTitle>
            <DialogDescription>
              {person.email} · {roleName}. The corrected name shows everywhere, history included.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>Full name</Label>
            <Input id={inputId} name="full_name" defaultValue={person.name} required autoComplete="off" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save name</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
