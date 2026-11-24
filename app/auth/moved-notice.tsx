import { signOutLocalAndReturn } from "@/app/actions/session"
import { COPY as DISCOUNT_COPY } from "@/app/discount-code/copy"
import { AuthHeading } from "@/components/auth-card"
import { Icon } from "@/components/icons"
import { Note } from "@/components/kit"
import type { Language } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { AGENTS_HOST, AGENTS_ORIGIN } from "@/lib/site-hosts"

import { LOGIN_COPY } from "./copy"

// Shown on portal.alrahmahcomplex.or.tz/auth to an already-signed-in Discount
// code holder (such as one opening the old installed portal app, #539 A-N6..A-N9).
// Uses a constant target URL and local-only sign-out.
export function MovedToAgentsNotice({ language, maskedLogin }: { language: Language; maskedLogin: string | null }) {
  const copy = LOGIN_COPY[language]
  const call = DISCOUNT_COPY[language].call
  const loginParts = maskedLogin ? copy.movedTextWithLogin(maskedLogin) : null

  return (
    <div className="flex w-full flex-col items-center gap-3.5 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-[var(--gf-whisper)] text-[var(--gf-indigo)]" aria-hidden="true">
        <Icon name="signout" size={24} featured />
      </span>

      <AuthHeading>{copy.movedTitle}</AuthHeading>

      <p className="-mt-2 text-[14.5px] leading-relaxed text-slate-700">
        {copy.movedTextPrefix}
        <b className="font-semibold text-slate-900">{AGENTS_HOST}</b>
        {loginParts ? (
          <>
            {loginParts.before}
            <b className="font-semibold text-slate-900">{loginParts.login}</b>
            {loginParts.after}
          </>
        ) : (
          copy.movedTextNoLogin
        )}
      </p>

      <p className="w-full rounded-2xl border border-dashed border-[var(--gf-line-strong)] px-3.5 py-2.5 font-exo text-[15px] font-bold italic text-[var(--gf-indigo)] [overflow-wrap:anywhere]">
        {AGENTS_HOST}
      </p>

      <a
        href={`${AGENTS_ORIGIN}/auth?from=moved`}
        className="kit-btn kit-go kit-wide !min-h-[52px] !text-[16px]"
      >
        <span>{copy.movedGo}</span>
        <Icon name="right" size={18} />
      </a>

      <Note>{copy.movedTip}</Note>

      <form action={signOutLocalAndReturn}>
        <input type="hidden" name="back" value="/auth" />
        <button
          type="submit"
          className="kit-link mt-1"
        >
          {copy.signOut}
        </button>
      </form>

      <div className="mt-1 flex flex-col items-center">
        <p className="text-[13px] text-slate-500">{call}</p>
        <a
          href={`tel:${OFFICE_PHONE.replaceAll(" ", "")}`}
          className="mt-0.5 inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 font-exo text-[16px] font-bold italic text-[var(--gf-indigo)] hover:bg-[var(--gf-whisper)]"
        >
          <Icon name="phone" size={18} />
          <span>{OFFICE_PHONE}</span>
        </a>
      </div>
    </div>
  )
}
