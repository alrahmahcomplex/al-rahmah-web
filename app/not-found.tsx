import Image from "next/image"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Any address the app does not know. It keeps the landing page's look, says
// it in Swahili and English at once (it reads no cookie, so it can't know the
// visitor's language), and offers the way home and, quietly, staff sign-in.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-gradient-to-br from-blue-50 via-blue-100/50 to-white px-4 py-4 sm:px-8 sm:py-6">
      <div className="flex w-full flex-1 flex-col items-center justify-center py-6">
        <section className="w-full max-w-[420px] rounded-[40px] bg-white px-6 py-10 text-center shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px] sm:px-8">
          <Image
            src="/Al-Rahmah_Official_Logo.svg"
            alt="Al-Rahmah Logo"
            width={140}
            height={140}
            className="mx-auto h-auto w-[120px] object-contain"
          />
          <h1 lang="sw" className="mt-6 font-exo text-[clamp(1.625rem,7vw,2rem)] leading-tight font-extrabold text-blue-600 italic">
            Ukurasa haupatikani
          </h1>
          <p className="mt-3 text-base text-slate-800">
            <span lang="sw">Anwani hii haipo.</span> <span className="text-slate-600">This page does not exist.</span>
          </p>
          <Link
            href="/"
            className={cn(
              buttonVariants({ variant: "orange" }),
              "mt-8 h-12 w-full rounded-full font-exo text-lg italic shadow-md shadow-orange-500/20",
            )}
          >
            <span lang="sw">Rudi mwanzo</span>
            <span aria-hidden="true">·</span>
            <span>Home</span>
          </Link>
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
