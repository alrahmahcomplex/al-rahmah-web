import checkLocalSupabase from "../tests/support/global-setup"
import { E2E_PORT, E2E_TURNSTILE_FAILS_PORT, servesThisBuild } from "./server"

// Local Supabase must answer, and the servers on the e2e ports must be this
// checkout's: a reused server from another worktree would test the wrong code.
export default async function globalSetup() {
  await checkLocalSupabase()
  for (const port of [E2E_PORT, E2E_TURNSTILE_FAILS_PORT]) {
    if (!(await servesThisBuild(port))) {
      throw new Error(
        `The server on port ${port} is not serving this checkout's build. ` +
          "Stop it (it may be another worktree's), then rerun, or run `npm run e2e:serve` here first.",
      )
    }
  }
}
