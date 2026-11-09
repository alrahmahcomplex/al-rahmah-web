import type { ReactNode } from "react"

import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

// The frame of every Discount code page (concept C): the lavender wash and
// one column. The brand top bar and the card go inside. Reads nothing and
// holds no server code, so the registration form (a client component) and
// the registration page (which must render with Supabase down) use it too.

// The card: 32px corners on phones, 40px from 640px, the indigo lift.
export const CARD = "rounded-[32px] bg-white px-5 py-6 shadow-[0_30px_80px_-15px_rgb(9_0_187/0.25)] max-[330px]:px-3 sm:rounded-[40px] sm:px-7 sm:py-8"

export function DiscountCodeFrame({ language, wide = false, children }: { language: Language; wide?: boolean; children: ReactNode }) {
  return (
    <main
      lang={language}
      className="min-h-dvh bg-white bg-[linear-gradient(135deg,#f2f0fc_0%,rgb(224_220_249/0.5)_45%,#fff_100%)] bg-fixed px-4 py-4 sm:px-8 sm:py-6"
    >
      <div className={cn("mx-auto flex w-full min-w-0 flex-col gap-4", wide ? "max-w-[640px]" : "max-w-[480px]")}>{children}</div>
    </main>
  )
}
