"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { Button, Field, FieldError } from "@/components/kit"
import { ROLE_TEMPLATES } from "@/lib/role-templates"

import { ChoiceList } from "../_form-parts/choice-list"
import { addRole } from "./actions"

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
      className="ro-new"
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
      <label htmlFor={templateId}>Start from</label>
      <ChoiceList
        id={templateId}
        size="small"
        value={template}
        aria-describedby={chosen ? summaryId : undefined}
        options={[{ value: "", label: "Blank role" }, ...ROLE_TEMPLATES.map((t) => ({ value: t.name, label: t.name }))]}
        onValueChange={(next) => {
          // The name follows the template until the Super Admin types their own.
          if (name === "" || ROLE_TEMPLATES.some((t) => t.name === name)) setName(next)
          setTemplate(next)
        }}
      />
      {chosen && (
        <p id={summaryId} className="ro-cap">
          {chosen.summary}
        </p>
      )}
      <label htmlFor={inputId}>Role name</label>
      <div className="ro-new-row">
        <Field
          id={inputId}
          name="name"
          size="compact"
          alignStart
          required
          autoComplete="off"
          placeholder="Role name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
        <Button type="submit" variant="ghost" size="small" disabled={pending}>
          {chosen ? "Create" : "Add"}
        </Button>
      </div>
      <FieldError id={errorId} message={error ?? undefined} alignStart />
    </form>
  )
}
