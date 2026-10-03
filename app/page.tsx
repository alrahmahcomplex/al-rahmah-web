import { Phone } from "lucide-react"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import { LanguageSwitch } from "@/components/language-switch"
import { getLanguage, type Language } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"

// The basic landing page a parent opens from a WhatsApp link. It reads no
// Supabase and stays out of the proxy matcher, so it loads with Supabase down.
// The full School Landing Page (programmes, photos, fees) is a later Feature.

const COPY: Record<
  Language,
  { welcome: string; pitch: readonly string[]; apply: string; question: string; description: string }
> = {
  sw: {
    welcome: "Karibu",
    pitch: [
      "Tunamlea mtoto wako kwa maadili ya Kiislamu pamoja na ubora wa taaluma, kuanzia Day Care hadi Kidato cha Nne, katika kampasi moja.",
      "Wanafunzi wetu hujifunza AI na roboti katika ICT Club na hupata mafunzo ya uongozi. Shule imethibitishwa na ISO 9001:2015 tangu 2023.",
    ],
    apply: "Omba sasa",
    question: "Una swali? Piga simu ofisi ya udahili",
    description: "Al-Rahmah Schools: maadili ya Kiislamu na ubora wa taaluma, kuanzia Day Care hadi Kidato cha Nne.",
  },
  en: {
    welcome: "Welcome to",
    pitch: [
      "We raise your child with Islamic values and strong academic results, from Day Care to Form 4, on one campus.",
      "Our students learn AI and robotics in the ICT Club and train as leaders. The school has held ISO 9001:2015 certification since 2023.",
    ],
    apply: "Apply now",
    question: "Questions? Call the admissions office",
    description: "Al-Rahmah Schools: Islamic values and strong academic results, from Day Care to Form 4.",
  },
}

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return { title: "Al-Rahmah Complex", description: COPY[language].description }
}

export default async function HomePage() {
  const language = await getLanguage()
  const copy = COPY[language]

  return (
    <main
      lang={language}
      className="min-h-dvh flex flex-col items-center bg-gradient-to-br from-blue-100 via-blue-100/50 to-white px-4 py-4 sm:px-8 sm:py-6"
    >
      <LanguageSwitch language={language} className="self-end" />

      <div className="flex w-full flex-1 flex-col items-center justify-center py-6">
        <section className="w-full max-w-[420px] rounded-[40px] bg-white px-6 py-10 shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px] sm:px-8">
          <div className="flex flex-col items-center text-center">
            <Image
              src="/Al-Rahmah_Official_Logo.svg"
              alt="Al-Rahmah Logo"
              width={140}
              height={140}
              className="h-auto w-[120px] object-contain"
              priority
            />

            <h1 className="mt-5 flex h-11 w-full items-center justify-center rounded-full bg-blue-600 font-exo text-base font-extrabold uppercase italic tracking-[1px] text-white shadow-sm">
              Al-Rahmah Complex
            </h1>

            <h2 className="mt-6 font-exo text-[clamp(1.625rem,7vw,2rem)] font-extrabold italic leading-tight text-blue-600">
              {copy.welcome} <span className="whitespace-nowrap">Al-Rahmah Schools</span>
            </h2>

            {copy.pitch.map((sentence) => (
              <p key={sentence} className="mt-3 text-base leading-relaxed text-slate-800">
                {sentence}
              </p>
            ))}

            <Link
              href="/apply"
              className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-orange-500 font-exo text-lg font-bold italic text-blue-600 shadow-md shadow-orange-500/20 outline-none transition hover:-translate-y-0.5 hover:bg-orange-600 hover:text-blue-900 focus-visible:ring-3 focus-visible:ring-blue-600/40 active:scale-95"
            >
              {copy.apply}
            </Link>

            <p className="mt-8 text-sm text-slate-600">{copy.question}</p>
            <a
              href={`tel:${OFFICE_PHONE.replaceAll(" ", "")}`}
              className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-exo text-lg font-bold italic text-blue-600 outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-blue-600/40"
            >
              <Phone className="size-5" strokeWidth={2} aria-hidden />
              {OFFICE_PHONE}
            </a>
          </div>
        </section>
      </div>

      <Link
        href="/login"
        className="inline-flex min-h-11 items-center px-3 text-sm text-slate-600 underline-offset-4 hover:text-blue-600 hover:underline"
      >
        Staff sign-in
      </Link>
    </main>
  )
}
