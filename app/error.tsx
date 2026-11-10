"use client"

import Link from "next/link"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"

// A public page that failed to render. In the landing page's look, in both
// languages, with Try again and the reference the office can quote when they
// report it (the digest matches the server log; the message never shows, as
// it may carry details).
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center bg-gradient-to-br from-blue-50 via-blue-100/50 to-white px-4 py-4 sm:px-8 sm:py-6">
      <div className="flex w-full flex-1 flex-col items-center justify-center py-6">
        <section className="w-full max-w-[420px] rounded-[40px] bg-white px-6 py-10 text-center shadow-[0_30px_80px_-15px] shadow-blue-600/25 sm:rounded-[50px] sm:px-8">
          <h1 lang="sw" className="font-exo text-[clamp(1.625rem,7vw,2rem)] leading-tight font-extrabold text-blue-600 italic">
            Kuna hitilafu
          </h1>
          <p className="mt-3 text-base text-slate-800">
            <span lang="sw">Ukurasa huu haukufunguka.</span>{" "}
            <span className="text-slate-600">This page could not be shown.</span>
          </p>
          <Button
            type="button"
            variant="orange"
            onClick={() => retry()}
            className="mt-8 h-12 w-full rounded-full font-exo text-lg italic shadow-md shadow-orange-500/20"
          >
            <span lang="sw">Jaribu tena</span>
            <span aria-hidden="true">·</span>
            <span>Try again</span>
          </Button>
          {error.digest && <p className="mt-4 font-mono text-xs text-slate-500">Reference: {error.digest}</p>}
        </section>
      </div>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center px-3 text-sm text-slate-600 underline-offset-4 hover:text-blue-600 hover:underline"
      >
        <span lang="sw">Rudi mwanzo</span>&nbsp;· Home
      </Link>
    </main>
  )
}
