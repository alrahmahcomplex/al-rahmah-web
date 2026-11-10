import type { MetadataRoute } from "next"

// Lets a parent save the site to the home screen. The icons are the full
// Al-Rahmah logo (never the emblem alone). No service worker: the forms send
// live data, and installing needs none.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Al-Rahmah Complex",
    short_name: "Al-Rahmah",
    description: "Al-Rahmah Schools: admissions and staff portal.",
    start_url: "/",
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
