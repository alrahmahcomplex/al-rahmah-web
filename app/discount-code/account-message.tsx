import Link from "next/link"

import { signOutAndReturn } from "@/app/actions/session"
import type { Language } from "@/lib/language"

import { ACCOUNT_COPY, type AccountMessage } from "./account-copy"

// A refusal or problem on a Discount code account page, with its reason code
// and the next step it points to.
export function AccountMessageView({ language, message }: { language: Language; message: AccountMessage }) {
  const copy = ACCOUNT_COPY[language]
  return (
    <div role="alert" className="flex flex-col gap-1 text-center font-exo text-[13px] text-red-600">
      <p>{message.text}</p>
      {message.code && <p className="text-[12px] text-slate-500">{copy.reasonCode(message.code)}</p>}
      {message.forgot && (
        <Link href="/login/forgot-password" className="text-blue-600 underline underline-offset-2">
          {copy.forgot}
        </Link>
      )}
      {message.signIn && (
        <Link href="/login" className="text-blue-600 underline underline-offset-2">
          {copy.goToSignIn}
        </Link>
      )}
    </div>
  )
}

// The message with a sign-out button, for a session that can't stay: staff
// signed in here, or a switched-off agent. Signing out returns to `back`.
export function SignOutNotice({ language, message, back }: { language: Language; message: AccountMessage; back: string }) {
  return (
    <form action={signOutAndReturn} className="flex flex-col items-stretch gap-4">
      <input type="hidden" name="back" value={back} />
      <AccountMessageView language={language} message={message} />
      <button
        type="submit"
        className="h-11 rounded-full bg-blue-600 font-exo text-base font-bold italic text-white shadow-md hover:bg-blue-700"
      >
        {ACCOUNT_COPY[language].signOut}
      </button>
    </form>
  )
}
