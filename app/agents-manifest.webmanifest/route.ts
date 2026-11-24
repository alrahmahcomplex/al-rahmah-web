import { agentsManifest } from "@/lib/portal-app"

// The agents app's web app manifest (lib/portal-app.ts), built once at deploy.
// On agents.alrahmahcomplex.or.tz, next.config.ts rewrites
// /manifest.webmanifest here (#539).
export const dynamic = "force-static"

export function GET(): Response {
  return new Response(JSON.stringify(agentsManifest()), {
    headers: { "content-type": "application/manifest+json" },
  })
}
