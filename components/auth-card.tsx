import Image from "next/image"
import type { ReactNode } from "react"

import { LanguageSwitch } from "@/components/language-switch"
import type { Language } from "@/lib/language"

// The card every sign-in page uses (#264): /login, /login/forgot-password,
// and the pages the set-password and reset emails open. The language switch
// sits above it, centred; the logo and name sit inside it, so moving between
// these pages looks like the card's contents changing.
export function AuthCard({ language, children }: { language: Language; children: ReactNode }) {
  return (
    <main
      lang={language}
      className="relative flex min-h-dvh w-full flex-col items-center bg-gradient-to-br from-blue-50 via-blue-100/50 to-white p-4 sm:p-8"
    >
      <LanguageSwitch language={language} className="shrink-0" />
      <div className="flex w-full flex-1 items-center justify-center py-6">
        <div className="flex w-[325px] max-w-full shrink-0 flex-col items-center rounded-[40px] bg-white px-8 py-[40px] shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px]">
          <div className="mb-5 shrink-0">
            <Image
              src="/Al-Rahmah_Official_Logo.svg"
              alt="Al-Rahmah Logo"
              width={140}
              height={140}
              className="h-auto w-[130px] object-contain"
              priority
            />
          </div>

          <div className="mb-4 flex h-11 w-full items-center justify-center rounded-full bg-blue-600 shadow-sm">
            <span className="font-exo text-[16px] font-extrabold uppercase italic tracking-[1px] text-white">AL-RAHMAH COMPLEX</span>
          </div>

          <div className="flex w-full flex-col">{children}</div>
        </div>
      </div>
    </main>
  )
}

export function AuthHeading({ children, intro }: { children: ReactNode; intro?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col items-center gap-2 text-center">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">{children}</h1>
      {intro && <p className="font-exo text-[13px] text-slate-600">{intro}</p>}
    </div>
  )
}
