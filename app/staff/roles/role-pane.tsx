"use client"

import { useRouter } from "next/navigation"
import { useEffect, useId, useRef, useState, useTransition } from "react"

import { Button, Card, Field, FieldError, Note, Popover, PopoverClose, SaveBar, Section, Sheet, Tag } from "@/components/kit"
import { PERMISSION_NEEDS } from "@/lib/permissions"
import { refusal, type PermissionOption } from "@/lib/services/staff-admin"

import { TickBox } from "../_form-parts/tick-box"
import {
  correctStaffMemberName,
  deactivateStaffMember,
  inviteStaffMember,
  moveStaffMember,
  reactivateRoleNow,
  reactivateStaffMember,
  renameRoleTo,
  resendStaffInvite,
  saveRole,
  sendStaffResetLink,
  retireRoleNow,
  type ChangeOutcome,
} from "./actions"
import {
  changeCount,
  draftChanges,
  EMPTY_DRAFT,
  selectManaged,
  selectPermission,
  shownManaged,
  shownPermissions,
  type Draft,
} from "./draft"
import type { PersonView, RoleOption, RoleView } from "./view"

type Run = (change: () => Promise<ChangeOutcome>) => void
type Track = (change: () => Promise<ChangeOutcome>) => Promise<ChangeOutcome>

// What the pane's callout shows: a first line, in bold when more follow.
type Outcome = ChangeOutcome & { lines?: string[] }

// A change that stops someone managing staff, or retires a role, waits here
// until the person confirms it.
type PendingConfirmation = { title: string; description: string; action: string; change: () => Promise<ChangeOutcome> }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

export function RolePane({
  role,
  permissions,
  children,
}: {
  role: RoleView
  permissions: PermissionOption[]
  children: React.ReactNode
}) {
  const router = useRouter()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
  // The last confirmation asked, so the sheet keeps its words while it slides out.
  const [asked, setAsked] = useState<PendingConfirmation | null>(null)
  if (confirmation && confirmation !== asked) setAsked(confirmation)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  // Where the person was going when they had unsaved changes.
  const [leaving, setLeaving] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [saving, startSaving] = useTransition()
  const subtitleId = useId()
  const retireReasonId = useId()
  const permissionIdPrefix = useId()
  const managedIdPrefix = useId()
  const bodyTop = useRef<HTMLDivElement>(null)

  const labelOf = (name: string) => permissions.find((p) => p.name === name)?.label ?? name
  const nameOf = (id: string) => role.managedOptions.find((option) => option.id === id)?.name ?? "a role"

  const savedManaged = role.managedOptions.filter((option) => option.checked).map((option) => option.id)
  const changes = draftChanges(
    role.permissions,
    permissions.map((p) => p.name),
    savedManaged,
    role.managedOptions.map((option) => option.id),
    draft,
  )
  const count = changeCount(changes)
  const shown = shownPermissions(role.permissions, draft)
  const shownManagedIds = shownManaged(savedManaged, draft)
  const busy = pending || saving

  const run: Run = (change) => {
    startTransition(async () => {
      setOutcome(await change())
    })
  }

  // A name sheet's save: part of `pending` like every other change, so the
  // buttons that open the sheets stay disabled until it lands and two name
  // saves never overlap. The sheet decides where the answer shows.
  const track: Track = (change) =>
    new Promise((resolve) => {
      startTransition(async () => {
        try {
          resolve(await change())
        } catch {
          // A dropped connection gets the same sentence as any other failure.
          resolve({ ok: false, message: refusal("unavailable").message })
        }
      })
    })

  // Save changes: one call with every change. On success the callout lists
  // what changed; on a refusal nothing was saved and the selections stay.
  const save = (then?: () => void) => {
    const sent = changes
    const sentCount = count
    startSaving(async () => {
      let answer: ChangeOutcome
      try {
        answer = await saveRole(role.id, sent)
      } catch {
        answer = { ok: false, message: "The connection dropped before the changes reached the database." }
      }
      // In the same transition as the refreshed role the save brings back, so
      // the boxes never show the old saved state in between.
      startSaving(() => {
        if (answer.ok) {
          const list = (items: readonly string[], name: (item: string) => string) => items.map(name).join(", ")
          setDraft(EMPTY_DRAFT)
          setOutcome({
            ...answer,
            lines: [
              sent.addPermissions.length > 0 && `Can now: ${list(sent.addPermissions, labelOf)}.`,
              sent.removePermissions.length > 0 && `Can no longer: ${list(sent.removePermissions, labelOf)}.`,
              sent.addManaged.length > 0 && `Now manages the staff in: ${list(sent.addManaged, nameOf)}.`,
              sent.removeManaged.length > 0 && `No longer manages the staff in: ${list(sent.removeManaged, nameOf)}.`,
            ].filter((line): line is string => typeof line === "string"),
          })
          then?.()
        } else {
          // Leaving waits: the person reads why first.
          setLeaving(null)
          setOutcome({
            ok: false,
            message: "Nothing was saved.",
            lines: [
              answer.message,
              `Your ${plural(sentCount, "change")} ${sentCount === 1 ? "is" : "are"} still shown below. Press Save changes to try again.`,
            ],
          })
        }
      })
      const body = bodyTop.current?.closest(".kit-card-body")
      if (body) body.scrollTop = 0
    })
  }

  // Leaving with unsaved changes asks first: a link in the page or the
  // sidebar, another role in the rail. Closing or reloading the tab gets the
  // browser's own question.
  useEffect(() => {
    if (count === 0) return
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return
      const to = new URL(link.href, window.location.href)
      if (to.origin !== window.location.origin) return
      if (to.pathname === window.location.pathname && to.search === window.location.search) return
      event.preventDefault()
      event.stopPropagation()
      setLeaving(to.pathname + to.search + to.hash)
    }
    const onUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    document.addEventListener("click", onClick, true)
    window.addEventListener("beforeunload", onUnload)
    return () => {
      document.removeEventListener("click", onClick, true)
      window.removeEventListener("beforeunload", onUnload)
    }
  }, [count])

  const leave = (to: string) => {
    setLeaving(null)
    setDraft(EMPTY_DRAFT)
    router.push(to)
  }

  return (
    <Card
      aria-labelledby="role-heading"
      className="ro-pane"
      fill
      foot={
        count > 0 && (
          <SaveBar
            label="Unsaved changes"
            message={`${plural(count, "change")} not saved`}
            undoLabel="Undo changes"
            saveLabel="Save changes"
            savingLabel="Saving…"
            saving={saving}
            onUndo={() => {
              setDraft(EMPTY_DRAFT)
              setOutcome(null)
            }}
            onSave={() => save()}
          />
        )
      }
    >
      <div ref={bodyTop} className="ro-top" />
      {outcome && (
        <div data-testid="role-outcome">
          <Note tone={outcome.ok ? "good" : "bad"} role={outcome.ok ? "status" : "alert"}>
            {outcome.lines && outcome.lines.length > 0 ? (
              <>
                <b>{outcome.message}</b>
                {outcome.lines.map((line) => (
                  <span key={line} className="ro-out-line">
                    {line}
                  </span>
                ))}
              </>
            ) : (
              outcome.message
            )}
          </Note>
        </div>
      )}

      <header className="ro-head">
        <div>
          <h2 id="role-heading" className="kit-card-title" data-retired={role.retired || undefined}>
            {role.name}
          </h2>
          <p id={subtitleId} className="ro-sub">
            {role.subtitle}
          </p>
        </div>
        {role.canEditRoles && (
          <div className="ro-acts">
            <Button
              variant="ghost"
              size="small"
              disabled={busy || !role.editable}
              aria-describedby={role.editable ? undefined : subtitleId}
              onClick={() => setRenaming(true)}
            >
              Rename
            </Button>
            {role.retired ? (
              <Button variant="ghost" size="small" disabled={busy} onClick={() => run(() => reactivateRoleNow(role.id))}>
                Reactivate role
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="small"
                disabled={busy || role.retireBlocked !== null}
                aria-describedby={role.retireBlocked ? retireReasonId : undefined}
                onClick={() =>
                  setConfirmation({
                    title: `Retire ${role.name}?`,
                    description: `Nobody can be given ${role.name} while it is retired. It stays in history, with the people who held it, and you can reactivate it later.`,
                    action: "Retire role",
                    change: () => retireRoleNow(role.id),
                  })
                }
              >
                Retire role
              </Button>
            )}
          </div>
        )}
        {role.retireBlocked && (
          <p id={retireReasonId} className="ro-reason">
            {role.retireBlocked}
          </p>
        )}
      </header>

      {role.canEditRoles ? (
        <fieldset className="kit-sec" aria-describedby={role.editable ? undefined : subtitleId}>
          <legend className="kit-sec-title">What this role can do</legend>
          <ul className="ro-ticks">
            {permissions.map((permission) => {
              const held = shown.includes(permission.name)
              const changed = held !== role.permissions.includes(permission.name)
              const checkboxId = `${permissionIdPrefix}-${permission.name}`
              const needed = PERMISSION_NEEDS[permission.name]
              const noteId = `${checkboxId}-note`
              return (
                <li key={permission.name}>
                  <TickBox
                    id={checkboxId}
                    checked={held}
                    disabled={busy || !role.editable}
                    aria-describedby={needed ? noteId : undefined}
                    onCheckedChange={(on) => setDraft((d) => selectPermission(role.permissions, d, permission.name, on))}
                  />
                  <div className="ro-tick-text">
                    <div className="ro-tick-line">
                      <label htmlFor={checkboxId} data-off={!held || undefined}>
                        {permission.label}
                      </label>
                      {changed && <Tag tone={held ? "ok" : "bad"}>{held ? "Added" : "Removed"}</Tag>}
                    </div>
                    {needed && (
                      <p id={noteId} className="ro-cap">
                        Needs “{labelOf(needed)}”. Selecting this selects it too; clearing that clears this.
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </fieldset>
      ) : (
        <Section title="What this role can do">
          {role.permissions.length === 0 ? (
            <p className="ro-plain ro-quiet">Nothing yet.</p>
          ) : (
            <ul aria-label={`What ${role.name} can do`} className="ro-ticks">
              {permissions
                .filter((permission) => role.permissions.includes(permission.name))
                .map((permission) => (
                  <li key={permission.name}>{permission.label}</li>
                ))}
            </ul>
          )}
        </Section>
      )}

      {role.canEditRoles ? (
        <fieldset className="kit-sec" aria-describedby={`${managedIdPrefix}-note`}>
          <legend className="kit-sec-title">Manages the staff in</legend>
          <p id={`${managedIdPrefix}-note`} className="ro-note">
            People in {role.name} can invite, deactivate, reactivate and move the staff in the roles selected here, between
            those roles only. They never change roles themselves.
          </p>
          {role.managedOptions.length === 0 ? (
            <p className="ro-plain ro-quiet">There is no other role yet.</p>
          ) : (
            <ul className="ro-ticks">
              {role.managedOptions.map((option) => {
                const checkboxId = `${managedIdPrefix}-${option.id}`
                const on = shownManagedIds.includes(option.id)
                const changed = on !== option.checked
                return (
                  <li key={option.id}>
                    <TickBox
                      id={checkboxId}
                      checked={on}
                      // A retired role can only be taken out of the set.
                      disabled={busy || role.retired || (option.retired && !option.checked)}
                      onCheckedChange={(manages) => setDraft((d) => selectManaged(savedManaged, d, option.id, manages))}
                    />
                    <div className="ro-tick-line">
                      <label htmlFor={checkboxId} data-off={!on || undefined}>
                        {option.name}
                        {option.retired && " (retired)"}
                      </label>
                      {changed && <Tag tone={on ? "ok" : "bad"}>{on ? "Added" : "Removed"}</Tag>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </fieldset>
      ) : (
        role.managesNames.length > 0 && (
          <Section title="Manages the staff in">
            <p className="ro-plain">{role.managesNames.join(", ")}</p>
          </Section>
        )
      )}

      {role.managed && (
        <Section title="People in this role">
          {role.people.length === 0 ? (
            <p className="ro-plain ro-quiet">Nobody holds this role.</p>
          ) : (
            <ul aria-label={`People in ${role.name}`} className="ro-people">
              {role.people.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  roleName={role.name}
                  pending={busy}
                  run={run}
                  track={track}
                  report={setOutcome}
                  confirm={setConfirmation}
                />
              ))}
            </ul>
          )}
        </Section>
      )}

      {role.managed && <InviteForm role={role} pending={busy} run={run} />}

      {children}

      <NameSheet
        open={renaming}
        onOpenChange={setRenaming}
        title={`Rename ${role.name}`}
        description="The new name shows everywhere, history included. Everyone in the role keeps what it can do."
        label="Role name"
        defaultValue={role.name}
        submit="Save name"
        save={(name) => track(() => renameRoleTo(role.id, name))}
        saving={busy}
        onSaved={setOutcome}
      />

      <Sheet
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
        placement="centre"
        title={asked?.title}
        hint={asked?.description}
        closeLabel="Close"
        foot={
          <>
            <Button
              size="wide"
              onClick={() => {
                if (confirmation) run(confirmation.change)
                setConfirmation(null)
              }}
            >
              {asked?.action}
            </Button>
            <Button variant="ghost" size="wide" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
          </>
        }
      >
        {null}
      </Sheet>

      <Sheet
        open={leaving !== null && count > 0}
        onOpenChange={(open) => !open && setLeaving(null)}
        placement="centre"
        title={`Save your changes to ${role.name}?`}
        hint={`You made ${plural(count, "change")} and haven't saved ${count === 1 ? "it" : "them"}. If you leave without saving, ${count === 1 ? "it goes" : "they go"} back to how ${count === 1 ? "it was" : "they were"}.`}
        closeLabel="Close"
        foot={
          <>
            <Button size="wide" pending={saving} onClick={() => save(() => leaving && leave(leaving))}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="bad" size="wide" disabled={saving} onClick={() => leaving && leave(leaving)}>
              Leave without saving
            </Button>
            <Button variant="ghost" size="wide" disabled={saving} onClick={() => setLeaving(null)}>
              Keep editing
            </Button>
          </>
        }
      >
        {null}
      </Sheet>
    </Card>
  )
}

function PersonRow({
  person,
  roleName,
  pending,
  run,
  track,
  report,
  confirm,
}: {
  person: PersonView
  roleName: string
  pending: boolean
  run: Run
  track: Track
  report: (outcome: ChangeOutcome) => void
  confirm: (confirmation: PendingConfirmation) => void
}) {
  const reasonsId = useId()
  const [renaming, setRenaming] = useState(false)

  const move = (target: RoleOption) => {
    const change = () => moveStaffMember(person.id, target.id)
    if (person.managesStaff && !target.managesStaff) {
      confirm({
        title: `Move ${person.name} to ${target.name}?`,
        description: `${person.name} will no longer manage anyone's staff in ${target.name}. The change applies on their next click.`,
        action: "Move",
        change,
      })
    } else {
      run(change)
    }
  }

  const deactivate = () => {
    const change = () => deactivateStaffMember(person.id)
    if (person.managesStaff) {
      confirm({
        title: `Deactivate ${person.name}?`,
        description: `${person.name} will lose access to the staff side on their next click, including managing staff. Their name stays on everything they recorded.`,
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
    <li aria-label={person.name} className="ro-person">
      <div className="ro-person-top">
        <div className="ro-person-who">
          <p className="ro-person-name" data-off={!person.active || undefined}>
            {person.name}
            {person.isYou && <span> (you)</span>}
          </p>
          <p className="ro-person-mail">{person.email}</p>
        </div>
        <Tag tone={person.status === "Active" ? "ok" : "line"}>{person.status}</Tag>
        <div className="ro-acts">
          <Popover
            size="narrow"
            className="ro-move"
            trigger={
              <Button
                variant="ghost"
                size="small"
                disabled={pending || person.moveBlocked !== null}
                aria-describedby={person.moveBlocked ? describedBy : undefined}
              >
                Move to…
              </Button>
            }
            title="Move to…"
            closeLabel="Close"
          >
            {person.moveTargets.map((target) => (
              <PopoverClose
                key={target.id}
                render={
                  <Button variant="ghost" size="small" onClick={() => move(target)}>
                    {target.name}
                  </Button>
                }
              />
            ))}
          </Popover>
          {person.active ? (
            <Button
              variant="ghost"
              size="small"
              disabled={pending || person.deactivateBlocked !== null}
              aria-describedby={person.deactivateBlocked ? describedBy : undefined}
              onClick={deactivate}
            >
              Deactivate
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="small"
              disabled={pending || person.reactivateBlocked !== null}
              aria-describedby={person.reactivateBlocked ? describedBy : undefined}
              onClick={() => run(() => reactivateStaffMember(person.id))}
            >
              Reactivate
            </Button>
          )}
          {person.canResendInvite && (
            <Button variant="ghost" size="small" disabled={pending} onClick={() => run(() => resendStaffInvite(person.id))}>
              Resend invite
            </Button>
          )}
          {person.canSendReset && (
            <Button variant="ghost" size="small" disabled={pending} onClick={() => run(() => sendStaffResetLink(person.id))}>
              Send reset link
            </Button>
          )}
          <Button variant="ghost" size="small" disabled={pending} onClick={() => setRenaming(true)}>
            Correct name
          </Button>
        </div>
      </div>

      {reasons.length > 0 && (
        <ul id={reasonsId} className="ro-reasons">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <NameSheet
        open={renaming}
        onOpenChange={setRenaming}
        title={`Correct ${person.name}'s name`}
        description={`${person.email} · ${roleName}. The corrected name shows everywhere, history included.`}
        label="Full name"
        defaultValue={person.name}
        submit="Save name"
        save={(fullName) => track(() => correctStaffMemberName(person.id, fullName))}
        saving={pending}
        onSaved={report}
      />
    </li>
  )
}

// Invites someone into the role in view. The form clears once the staff
// record exists, even if the email then failed: the person is in the list
// above with Resend invite, so typing them again would only be refused.
function InviteForm({ role, pending, run }: { role: RoleView; pending: boolean; run: Run }) {
  const nameId = useId()
  const emailId = useId()
  const blockedId = useId()
  const form = useRef<HTMLFormElement>(null)
  const blocked = role.inviteBlocked !== null

  return (
    <form
      ref={form}
      aria-labelledby={`${nameId}-heading`}
      className="kit-sec ro-form"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        run(async () => {
          const outcome = await inviteStaffMember(role.id, String(data.get("fullName") ?? ""), String(data.get("email") ?? ""))
          if (outcome.created) form.current?.reset()
          return outcome
        })
      }}
    >
      <h3 id={`${nameId}-heading`} className="kit-sec-title">
        Invite someone to {role.name}
      </h3>
      <fieldset disabled={pending || blocked} aria-describedby={blocked ? blockedId : undefined}>
        <div className="ro-form-fields">
          <div>
            <label htmlFor={nameId}>Full name</label>
            <Field id={nameId} name="fullName" size="compact" alignStart required autoComplete="off" />
          </div>
          <div>
            <label htmlFor={emailId}>Email</label>
            <Field id={emailId} name="email" type="email" size="compact" alignStart required autoComplete="off" />
          </div>
        </div>
        <div className="ro-form-foot">
          <Button type="submit" size="small">
            Send invite
          </Button>
          <p id={blockedId}>{role.inviteBlocked ?? "They get an email with a link to set their password."}</p>
        </div>
      </fieldset>
    </form>
  )
}

// One text field in a sheet: correcting a person's name, renaming a role.
// It stays open until the save lands. A refusal (a name another role has)
// shows inside it, so the typed name can be fixed in place; a success
// closes it and goes to the pane's callout. It can be closed mid-save; that
// save's answer then goes to the callout. The pane keeps the buttons that
// open it disabled until the save lands, so it can't be reopened meanwhile.
function NameSheet({
  open,
  onOpenChange,
  title,
  description,
  label,
  defaultValue,
  submit,
  save,
  saving,
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
  saving: boolean
  onSaved: (outcome: ChangeOutcome) => void
}) {
  const formId = useId()
  const inputId = useId()
  const errorId = useId()
  const [error, setError] = useState<string | null>(null)
  // Counts closings, so a save can tell whether its sheet was closed
  // before its answer arrived.
  const closings = useRef(0)

  const changeOpen = (next: boolean) => {
    if (!next) {
      closings.current += 1
      setError(null)
    }
    onOpenChange(next)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={changeOpen}
      placement="centre"
      title={title}
      hint={description}
      closeLabel="Close"
      foot={
        <>
          <Button type="submit" form={formId} size="wide" disabled={saving}>
            {submit}
          </Button>
          <Button variant="ghost" size="wide" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="ro-sheet-form"
        onSubmit={(event) => {
          event.preventDefault()
          const name = String(new FormData(event.currentTarget).get("name") ?? "")
          const mine = closings.current
          void save(name).then((outcome) => {
            if (mine !== closings.current) {
              // Closed while saving: report it in the pane, nowhere else.
              onSaved(outcome)
              return
            }
            if (!outcome.ok) {
              setError(outcome.message)
              return
            }
            changeOpen(false)
            onSaved(outcome)
          })
        }}
      >
        <label htmlFor={inputId}>{label}</label>
        <Field
          id={inputId}
          name="name"
          size="compact"
          alignStart
          defaultValue={defaultValue}
          required
          autoComplete="off"
          invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
        <FieldError id={errorId} message={error ?? undefined} alignStart />
      </form>
    </Sheet>
  )
}
