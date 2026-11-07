"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ROLE_TEMPLATES } from "@/lib/role-templates"

import { addRole } from "./actions"

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"

// The Super Admin's "New role" at the bottom of the rail (#241). "Start
// from" picks a template, which fills in the name and brings the template's
// permissions and managed set; "Blank" starts with none. The new role opens
// in the pane. A refusal (a name already taken) shows under the form.
export function NewRoleForm() {
  const router = useRouter()
  const templateId = useId()
  const inputId = useId()
  const summaryId = useId()
  const errorId = useId()
  const [template, setTemplate] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const chosen = ROLE_TEMPLATES.find((t) => t.name === template)

  return (
    <form
      aria-label="New role"
      className="mt-2 flex flex-col gap-1.5 border-t px-2 pt-3 pb-1"
      onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          const outcome = await addRole(name, template || null)
          if (!outcome.ok || !outcome.roleId) {
            setError(outcome.message)
            return
          }
          setError(null)
          setTemplate("")
          setName("")
          router.push(`/staff/roles?role=${outcome.roleId}`)
        })
      }}
    >
      <Label htmlFor={templateId} className="text-xs text-muted-foreground">
        Start from
      </Label>
      <select
        id={templateId}
        className={SELECT_CLASS}
        value={template}
        aria-describedby={chosen ? summaryId : undefined}
        onChange={(event) => {
          const next = event.target.value
          // The name follows the template until the Super Admin types their own.
          if (name === "" || ROLE_TEMPLATES.some((t) => t.name === name)) setName(next)
          setTemplate(next)
        }}
      >
        <option value="">Blank role</option>
        {ROLE_TEMPLATES.map((t) => (
          <option key={t.name} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>
      {chosen && (
        <p id={summaryId} className="text-xs text-muted-foreground">
          {chosen.summary}
        </p>
      )}
      <Label htmlFor={inputId} className="mt-1 text-xs text-muted-foreground">
        Role name
      </Label>
      <div className="flex gap-1.5">
        <Input
          id={inputId}
          name="name"
          required
          autoComplete="off"
          placeholder="Role name"
          className="h-8 min-w-0 staff-touch:h-8"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <Button type="submit" size="sm" disabled={pending}>
          {chosen ? "Create" : "Add"}
        </Button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
