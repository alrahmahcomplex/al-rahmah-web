import { signOutAndReturn } from "@/app/actions/session"

export const AGENT_SESSION = "This browser is signed in to the Discount code pages. Sign out first, then sign in here."

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
