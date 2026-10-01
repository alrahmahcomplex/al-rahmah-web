import { existsSync, readFileSync } from "node:fs"

// The browser tests' port. Every worktree uses it, so it is only ever served
// while holding the shared lock (docs/agents/parallel-work.md).
export const E2E_PORT = 3100

// Whether the server on the port serves this checkout's build. Every
// `next build` gets a fresh build ID, and the server answers for its own
// build's static files only, so another worktree's server returns 404 here.
export async function servesThisBuild(): Promise<boolean> {
  if (!existsSync(".next/BUILD_ID")) return false
  const buildId = readFileSync(".next/BUILD_ID", "utf8").trim()
  const response = await fetch(`http://localhost:${E2E_PORT}/_next/static/${buildId}/_buildManifest.js`)
  return response.ok
}
