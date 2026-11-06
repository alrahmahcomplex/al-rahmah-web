import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"

import { LanguageSwitch } from "@/components/language-switch"
import type { Language } from "@/lib/language"

import { ACCOUNT_COPY } from "./account-copy"

// The frame of the Discount code account pages: the Discount code page's
// header, then the page's card.
export function AccountShell({ language, children, wide = false }: { language: Language; children: ReactNode; wide?: boolean }) {
  return (
    <main
      lang={language}
      className="min-h-dvh bg-gradient-to-br from-blue-50 via-blue-100/50 to-white px-4 py-4 sm:px-8 sm:py-6"
    >
      <div className={`mx-auto flex w-full flex-col gap-4 ${wide ? "max-w-[640px]" : "max-w-[420px]"}`}>
        <header className="flex items-center gap-3">
          <Link href="/" className="shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40">
            <Image src="/Al-Rahmah_Official_Logo.svg" alt="Al-Rahmah Logo" width={44} height={44} className="size-11" priority />
          </Link>
          <p className="min-w-0 font-exo text-lg font-extrabold italic leading-tight text-blue-600">
            {ACCOUNT_COPY[language].title}
          </p>
          <LanguageSwitch language={language} className="ml-auto shrink-0" />
        </header>
        <div className="rounded-[32px] bg-white px-6 py-8 shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:px-8">{children}</div>
      </div>
    </main>
  )
}
