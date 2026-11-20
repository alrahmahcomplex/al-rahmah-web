import type { Metadata, MetadataRoute } from "next"

// The Admissions Portal installs as an app; the public site does not (#497).
// Staff and Discount code agents add the portal to their home screen, and
// parents on the landing page or the Admission form get no install offer.
//
// Install is opt-in per page: the top layout of each portal path
// (PORTAL_PATHS in lib/site-hosts.ts) spreads PORTAL_APP_METADATA into its
// metadata, so a new public page gets no install tags. The manifest is a
// route handler, not app/manifest.ts, because that file convention links the
// manifest from every page.
//
// Static on purpose: nothing here reads the request, so the cached
// /login/forgot-password copy stays prerendered (ADR 0006).
export const PORTAL_APP_METADATA = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Al-Rahmah", statusBarStyle: "default" },
} satisfies Metadata

// The icons are the full Al-Rahmah logo (never the emblem alone). No service
// worker: the forms send live data, and installing needs none.
//
// The app opens on sign-in, which sends someone already signed in on to their
// own home. `id` is fixed so moving the start page later (#497 slice C) keeps
// the installed app the same app.
export function portalManifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Al-Rahmah Complex",
    short_name: "Al-Rahmah",
    description: "Al-Rahmah Schools: admissions and staff portal.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0900bb",
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
