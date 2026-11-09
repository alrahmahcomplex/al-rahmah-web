import type { ComponentProps, ReactNode } from "react"

import { Button } from "@/components/ui/button"

// A button whose label says what is happening while its action runs ("Saving…"),
// switched in the same frame as the click: pass the `pending` flag from
// useTransition or useActionState. No spinner; the words carry it.
export function PendingButton({
  pending,
  pendingLabel,
  disabled,
  children,
  ...props
}: ComponentProps<typeof Button> & { pending: boolean; pendingLabel: ReactNode }) {
  return (
    <Button {...props} disabled={pending || disabled} aria-busy={pending || undefined}>
      {pending ? pendingLabel : children}
    </Button>
  )
}
