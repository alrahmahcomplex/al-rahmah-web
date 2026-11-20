import { ChevronRight, Phone } from "lucide-react"
import type { CSSProperties } from "react"

import { signOutAndReturn } from "@/app/actions/session"
import { NoticeBox } from "@/components/guided-form"
import { Icon } from "@/components/icons"
import { buttonVariants } from "@/components/ui/button"
import type { Language } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { cn } from "@/lib/utils"

import { ACCOUNT_COPY, type OffReason } from "./account-copy"
import { COPY as DISCOUNT_COPY } from "./copy"

// The students page for a code that is switched off or retired, or while the
// pages are paused for everyone (#497 state 6, prototype v45): a kit icon in a
// lavender disc, a short title, one sentence, the orange Sign out and the
// office's number. The title says which case it is, so no reason code shows.
// Read fresh on every visit, like the list it replaces.
export function AccountOffCard({ language, reason }: { language: Language; reason: OffReason }) {
  const copy = ACCOUNT_COPY[language]
  const { title, text } = copy.off[reason]
  const call = DISCOUNT_COPY[language].call
  return (
    <section role="alert" className="flex flex-col items-center gap-4 text-center">
      <span
        className="grid size-16 place-items-center rounded-full bg-[#f2f0fc]"
        style={{ "--icon-line": "#0900bb", "--icon-detail": "#ee7300" } as CSSProperties}
      >
        <Icon name={reason === "retired" ? "info" : "clock"} size={24} />
      </span>
      <h2 className="font-exo text-[26px] leading-[1.18] font-extrabold tracking-[-0.01em] text-balance text-blue-600 italic">{title}</h2>
      <NoticeBox tone={reason === "retired" ? "info" : "wait"} className="w-full text-[15px]">
        {text}
      </NoticeBox>
      <form action={signOutAndReturn} className="w-full">
        <input type="hidden" name="back" value="/auth" />
        <button
          type="submit"
          className={cn(buttonVariants({ variant: "orange" }), "min-h-13 w-full justify-between rounded-full pr-4 pl-6 font-exo text-lg italic shadow-md shadow-orange-500/20")}
        >
          {copy.signOut}
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </form>
      <div className="flex flex-col items-center">
        <p className="text-sm text-slate-600">{call}</p>
        <a
          href={`tel:${OFFICE_PHONE.replaceAll(" ", "")}`}
          className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-exo text-lg font-bold text-blue-600 italic outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring)"
        >
          <Phone className="size-5" strokeWidth={2} aria-hidden />
          {OFFICE_PHONE}
        </a>
      </div>
    </section>
  )
}
