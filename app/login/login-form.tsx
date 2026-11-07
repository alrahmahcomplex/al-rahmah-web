"use client"

import { Eye, EyeOff, Lock, User } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useActionState, useState } from "react"

import { signOutAndReturn } from "@/app/actions/session"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { signIn, type SignInState } from "./actions"

export type LoginNotice = "invalid-link" | "not-staff" | "deactivated" | "unavailable"

export const AGENT_SESSION = "This browser is signed in to the Discount code pages. Sign out first, then sign in here."

const MESSAGES: Record<NonNullable<SignInState>["error"] | LoginNotice, string> = {
  "invalid-credentials": "Wrong email or password.",
  "not-staff": "This account is not on the staff list. Ask an Admissions Manager to invite you.",
  deactivated: "Your staff account is deactivated. Ask an Admissions Manager to reactivate it.",
  unavailable: "Sign-in is unavailable right now. Try again in a moment.",
  "invalid-link": "That sign-in link is invalid or has expired.",
  "rate-limited": "Too many sign-in attempts from this network. Wait a few minutes, then try again.",
  banned: "This account can't sign in. Ask an Admissions Manager.",
  "agent-session": AGENT_SESSION,
}

export function LoginForm({ notice, agentSession }: { notice: LoginNotice | null; agentSession: boolean }) {
  const [state, formAction, pending] = useActionState(signIn, null)
  const [showPassword, setShowPassword] = useState(false)
  const message = state ? MESSAGES[state.error] : notice ? MESSAGES[notice] : null

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-blue-100/50 to-white w-full p-4 sm:p-8 relative">
      <div className="w-[325px] max-w-[90vw] shrink-0 bg-white px-8 py-[40px] rounded-[40px] sm:rounded-[50px] shadow-[0_30px_80px_-15px] shadow-blue-600/25 flex flex-col items-center">
        <div className="mb-5 shrink-0">
          <Image
            src="/Al-Rahmah_Official_Logo.svg"
            alt="Al-Rahmah Logo"
            width={140}
            height={140}
            className="object-contain w-[130px] h-auto"
            priority
          />
        </div>

        <div className="w-full h-11 bg-blue-600 rounded-full mb-4 flex justify-center items-center shadow-sm">
          <span className="text-white font-exo font-extrabold italic uppercase tracking-[1px] text-[16px]">
            AL-RAHMAH COMPLEX
          </span>
        </div>

        <h1 className="text-blue-600 font-exo font-extrabold italic text-2xl mb-5">Welcome!</h1>

        {agentSession ? (
          <OtherSessionNotice message={AGENT_SESSION} back="/login" />
        ) : (
          <form action={formAction} className="w-full flex flex-col gap-3">
            <div className="relative">
              <label htmlFor="email" className="sr-only">
                Email
              </label>
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <User className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
              </div>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="Email"
                className="w-full bg-white border border-blue-600/30 rounded-full h-11 pl-10 pr-4 outline-none focus:border-blue-600 transition-colors placeholder:text-slate-400 text-slate-800 text-base"
                required
              />
            </div>

            <div className="relative">
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
              </div>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Password"
                className="w-full bg-white border border-blue-600/30 rounded-full h-11 pl-10 pr-10 outline-none focus:border-blue-600 transition-colors placeholder:text-slate-400 text-slate-800 text-base"
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" strokeWidth={1.5} />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={1.5} />
                )}
              </button>
            </div>

            {message && (
              <p role="alert" className="text-center text-[12px] font-exo text-red-600">
                {message}
              </p>
            )}

            <button
              disabled={pending}
              type="submit"
              className={cn(buttonVariants({ variant: "orange" }), "h-11 w-full rounded-full font-exo text-base italic shadow-md shadow-orange-500/20 transition-transform hover:-translate-y-0.5 active:scale-95 disabled:opacity-70 disabled:hover:translate-y-0")}
            >
              {pending ? "Processing..." : "Log In"}
            </button>
          </form>
        )}

        <Link
          href="/discount-code/sign-in"
          className="mt-5 text-center text-[12px] font-exo text-blue-600 underline underline-offset-2"
        >
          Discount code holders sign in here
        </Link>
      </div>
    </main>
  )
}

// Shown instead of a form while this browser is signed in as the other kind
// of account. Signing out returns to `back`, so an invite link still works.
export function OtherSessionNotice({
  message,
  back,
  signOutLabel = "Sign out",
}: {
  message: string
  back: string
  signOutLabel?: string
}) {
  return (
    <form action={signOutAndReturn} className="w-full flex flex-col items-center gap-3">
      <input type="hidden" name="back" value={back} />
      <p role="alert" className="text-center text-[13px] font-exo text-red-600">
        {message}
      </p>
      <button
        type="submit"
        className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-exo font-bold italic text-base shadow-md"
      >
        {signOutLabel}
      </button>
    </form>
  )
}
