import checkLocalSupabase from "../tests/support/global-setup"
import { E2E_PORT, servesThisBuild } from "./server"

// Local Supabase must answer, and the server on the e2e port must be this
// checkout's: a reused server from another worktree would test the wrong code.
export default async function globalSetup() {
  await checkLocalSupabase()
  if (!(await servesThisBuild())) {
    throw new Error(
      `The server on port ${E2E_PORT} is not serving this checkout's build. ` +
        "Stop it (it may be another worktree's), then rerun, or run `npm run e2e:serve` here first.",
    )
  }
}
