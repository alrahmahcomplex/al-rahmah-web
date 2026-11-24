import type { Metadata, MetadataRoute } from "next"

// Theme colours for the three hosts (#539): the public site stays brand blue,
// the staff portal turns orange and the agents app uses the dark-blue logo's
// indigo. Root viewport.themeColor beats the manifest, so each app's layout
// sets its own.
export const PUBLIC_THEME_COLOR = "#0900bb"
export const PORTAL_THEME_COLOR = "#ee7300"
export const AGENTS_THEME_COLOR = "#2408B2"

// The Admissions Portal and the agents app install as apps; the public site
// does not (#497, #539). Staff and Discount code holders add their app to
// their home screen, and parents on the landing page or Admission form get no
// install offer.
//
// Install is opt-in per page: the top layout of each staff and agent path
// (STAFF_PATHS and AGENT_PATHS in lib/site-hosts.ts) spreads
// PORTAL_APP_METADATA into its metadata, so a new public page gets no install
// tags. The manifests are static route handlers, not app/manifest.ts, because
// that file convention links the manifest from every page. On the agents host,
// next.config.ts rewrites /manifest.webmanifest to /agents-manifest.webmanifest.
//
// Static on purpose: nothing here reads the request, so the cached
// /auth/forgot-password copy stays prerendered (ADR 0006).
export const PORTAL_APP_METADATA = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Al-Rahmah", statusBarStyle: "default" },
} satisfies Metadata

// The icons are the full Al-Rahmah logo (never the emblem alone). No service
// worker: the forms send live data, and installing needs none.
//
// Both apps keep the name "Al-Rahmah" and open on sign-in, which sends someone
// already signed in on to their own home. `id` stays "/" so moving start_url
// keeps an installed app the same app.
export function portalManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Al-Rahmah Complex",
    short_name: "Al-Rahmah",
    description: "Al-Rahmah Schools: admissions and staff portal.",
    start_url: "/auth",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: PORTAL_THEME_COLOR,
    lang: "sw",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/monochrome-432.png", sizes: "432x432", type: "image/png", purpose: "monochrome" },
    ],
  }
}

export function agentsManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Al-Rahmah Complex",
    short_name: "Al-Rahmah",
    description: "Al-Rahmah Schools: Discount code.",
    start_url: "/auth",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: AGENTS_THEME_COLOR,
    lang: "sw",
    icons: [
      { src: "/agents/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/agents/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/agents/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/agents/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/agents/icons/monochrome-432.png", sizes: "432x432", type: "image/png", purpose: "monochrome" },
    ],
  }
}
