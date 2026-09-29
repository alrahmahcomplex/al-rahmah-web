"use client"

import { useRouter } from "next/navigation"
import { useId, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { addRole } from "./actions"

// "New role" and Add at the bottom of the rail. The new role starts with no
// permissions and opens in the pane. A refusal (a name already taken) shows
// under the field, where the name was typed.
export function NewRoleForm() {
  const router = useRouter()
  const inputId = useId()
  const errorId = useId()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form
      className="mt-2 flex flex-col gap-1.5 border-t px-2 pt-3 pb-1"
      onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        const name = String(new FormData(form).get("name") ?? "")
        startTransition(async () => {
          const outcome = await addRole(name)
          if (!outcome.ok || !outcome.roleId) {
            setError(outcome.message)
            return
          }
          setError(null)
          form.reset()
          router.push(`/staff/roles?role=${outcome.roleId}`)
        })
      }}
    >
      <Label htmlFor={inputId} className="text-xs text-muted-foreground">
        New role
      </Label>
      <div className="flex gap-1.5">
        <Input
          id={inputId}
          name="name"
          required
          autoComplete="off"
          placeholder="Role name"
          className="h-8 min-w-0"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <Button type="submit" size="sm" disabled={pending}>
          Add
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
