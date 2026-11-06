// PostgREST caches its clock, and some releases let that cache fall more than
// its 30 seconds of allowed skew behind, so a token issued a moment ago is
// refused as "issued at future" (PostgREST issue #5196, fixed in v14.18 and
// v16.3). The token is fine; PostgREST re-checks it against a fresh clock on
// the next request, so one more read a second later settles it. Every read
// that decides who is signed in goes through this: the staff record, the
// agent account and the one-account check.
const CLOCK_CATCH_UP_MS = 1000

function isIssuedAtFuture(error: { code?: string; message?: string } | null) {
  return error?.code === "PGRST303" && error.message === "JWT issued at future"
}

// Runs `read`, and once more after a second if PostgREST refused the token as
// issued in the future. Any other answer, or a second refusal, is returned.
export async function readWithClockRetry<T extends { error: { code?: string; message?: string } | null }>(
  read: () => PromiseLike<T>,
): Promise<T> {
  const first = await read()
  if (!isIssuedAtFuture(first.error)) return first
  await new Promise((resolve) => setTimeout(resolve, CLOCK_CATCH_UP_MS))
  return read()
}
