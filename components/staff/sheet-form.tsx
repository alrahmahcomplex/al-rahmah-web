"use client"

import { XIcon } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

// The staff portal's edit sheet: everything a list row edits opens here, never
// in a stacked dialog. A header with the title, a meta line (chips, counts,
// import steps) and Close; a body that scrolls; a footer that stays in view
// with Cancel and the one primary action. 460px from the right (720px when
// `wide`), and a bottom sheet on a phone.
//
// Pass `form` to wrap the body and footer in a <form>, so the primary button
// can be type="submit". `cancel` names the Cancel button, or false hides it
// (an import's Done step has only "Show them in Leads").
export function SheetForm({
  open,
  onOpenChange,
  title,
  description,
  meta,
  wide = false,
  form,
  cancel = "Cancel",
  footerStart,
  footer,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  // For screen readers when the meta line does not explain the sheet.
  description?: ReactNode
  meta?: ReactNode
  wide?: boolean
  form?: Omit<ComponentProps<"form">, "children" | "className">
  cancel?: string | false
  // Left of the footer, such as "Download the 2 skipped rows".
  footerStart?: ReactNode
  // The primary action (and any second one), right of Cancel.
  footer?: ReactNode
  className?: string
  children: ReactNode
}) {
  const body = (
    <>
      <div data-slot="sheet-form-body" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        {children}
      </div>
      {(footer || footerStart || cancel) && (
        <div
          data-slot="sheet-form-footer"
          className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-6 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]"
        >
          {footerStart && <div className="mr-auto flex min-w-0 items-center">{footerStart}</div>}
          {cancel && (
            <SheetClose render={<Button type="button" variant="ghost" />}>{cancel}</SheetClose>
          )}
          {footer}
        </div>
      )}
    </>
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(
          "gap-0 p-0 motion-reduce:transition-none",
          "data-[side=right]:w-full",
          wide ? "data-[side=right]:sm:max-w-[720px]" : "data-[side=right]:sm:max-w-[460px]",
          // A phone gets a bottom sheet that rises instead of sliding in.
          "max-sm:data-[side=right]:inset-x-0 max-sm:data-[side=right]:top-auto max-sm:data-[side=right]:bottom-0 max-sm:data-[side=right]:h-auto max-sm:data-[side=right]:max-h-[92dvh]",
          "max-sm:data-[side=right]:rounded-t-2xl max-sm:data-[side=right]:border-t max-sm:data-[side=right]:border-l-0",
          "max-sm:data-[side=right]:data-starting-style:translate-x-0 max-sm:data-[side=right]:data-starting-style:translate-y-10",
          "max-sm:data-[side=right]:data-ending-style:translate-x-0 max-sm:data-[side=right]:data-ending-style:translate-y-10",
          className,
        )}
      >
        <div data-slot="sheet-form-header" className="flex shrink-0 items-start gap-3 border-b px-6 pt-5 pb-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <SheetTitle className="text-[17px]/6 font-semibold tracking-tight text-slate-900">{title}</SheetTitle>
            {meta && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{meta}</div>}
            {description && <SheetDescription className="sr-only">{description}</SheetDescription>}
          </div>
          <SheetClose render={<Button type="button" variant="ghost" size="icon" className="-mt-1 -mr-2 text-slate-500" />}>
            <XIcon aria-hidden="true" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>
        {form ? (
          <form {...form} className="flex min-h-0 flex-1 flex-col">
            {body}
          </form>
        ) : (
          body
        )}
      </SheetContent>
    </Sheet>
  )
}
