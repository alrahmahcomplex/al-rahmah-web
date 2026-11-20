import { portalManifest } from "@/lib/portal-app"

// The portal's web app manifest (lib/portal-app.ts), built once at deploy.
// On the public host next.config.ts sends this address to the portal, so the
// public site serves no manifest (#497).
export const dynamic = "force-static"

export function GET(): Response {
  return new Response(JSON.stringify(portalManifest()), {
    headers: { "content-type": "application/manifest+json" },
  })
}
