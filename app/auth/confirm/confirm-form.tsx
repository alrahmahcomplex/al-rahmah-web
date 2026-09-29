"use client"

import { Eye, EyeOff, Lock } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useActionState, useState } from "react"

import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"

import { setInvitePassword, type AcceptInviteState } from "./actions"

const EXPIRED = "This invite link has expired or was already used. Ask an Admissions Manager to send a new one."

const MESSAGES: Record<NonNullable<AcceptInviteState>["error"], string> = {
  "password-too-short": `Use at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
  "password-mismatch": "The two passwords don't match.",
  "invalid-link": EXPIRED,
  deactivated: "Your staff account was deactivated before you accepted the invite. Ask an Admissions Manager to reactivate it.",
  "not-staff": "This account is not on the staff list. Ask an Admissions Manager to invite you.",
  "password-not-saved": "Your password could not be saved. Try again in a moment.",
  "joined-unavailable": "Your password is set, but the staff side isn't answering right now. Sign in with it in a moment.",
  unavailable: "Something went wrong. Open the link from your email again in a moment.",
}

// Errors after which the link is spent, so the form goes away.
const FINAL = new Set<keyof typeof MESSAGES>(["invalid-link", "deactivated", "not-staff", "joined-unavailable"])

const INPUT =
  "w-full bg-white border border-blue-600/30 rounded-full h-11 pl-10 pr-10 outline-none focus:border-blue-600 transition-colors font-exo font-light italic placeholder:text-slate-400 text-slate-800 text-[12px]"

export function ConfirmForm({ tokenHash }: { tokenHash: string | null }) {
  const [state, formAction, pending] = useActionState(setInvitePassword, null)
  const [showPassword, setShowPassword] = useState(false)
  const message = !tokenHash ? EXPIRED : state ? MESSAGES[state.error] : null
  const showForm = tokenHash !== null && !(state && FINAL.has(state.error))

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-100 via-blue-100/50 to-white w-full p-4 sm:p-8 relative">
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

        <h1 className="text-blue-600 font-exo font-extrabold italic text-2xl mb-2">Set your password</h1>
        {showForm && (
          <p className="text-center text-[12px] font-exo text-slate-500 mb-5">
            You&apos;ll use it with your email address to sign in to the staff side.
          </p>
        )}

        {showForm ? (
          <form action={formAction} className="w-full flex flex-col gap-3">
            <input type="hidden" name="token_hash" value={tokenHash ?? ""} />

            {(["password", "confirm"] as const).map((field) => (
              <div key={field} className="relative">
                <label htmlFor={field} className="sr-only">
                  {field === "password" ? "New password" : "Confirm new password"}
                </label>
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-400" strokeWidth={1.5} />
                </div>
                <input
                  id={field}
                  name={field}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={field === "password" ? "New password" : "Confirm new password"}
                  className={INPUT}
                  required
                  minLength={MINIMUM_PASSWORD_LENGTH}
                />
                {field === "password" && (
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-label={showPassword ? "Hide passwords" : "Show passwords"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" strokeWidth={1.5} /> : <Eye className="h-4 w-4" strokeWidth={1.5} />}
                  </button>
                )}
              </div>
            ))}

            {message && (
              <p role="alert" className="text-center text-[12px] font-exo text-red-600">
                {message}
              </p>
            )}

            <button
              disabled={pending}
              type="submit"
              className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white rounded-full font-exo font-bold italic text-base transition-transform hover:-translate-y-0.5 shadow-md shadow-orange-500/20 active:scale-95 disabled:opacity-70 disabled:hover:translate-y-0"
            >
              {pending ? "Saving..." : "Set password"}
            </button>
          </form>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <p role="alert" className="text-center text-[13px] font-exo text-red-600">
              {message}
            </p>
            <Link href="/login" className="text-[12px] font-exo text-blue-600 underline underline-offset-2">
              Go to sign-in
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}
