import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"

import { KeepFocusInView } from "@/components/guided-form/keep-in-view"
import { PageLanguageProvider } from "@/components/page-language"
import { Toaster } from "@/components/ui/sonner"
import { VercelInsights } from "@/components/vercel-insights"
import { cn } from "@/lib/utils"

// The design tokens (DESIGN.md): every page, globals.css and each component
// stylesheet read the --gf-* values from here.
import "./tokens.css"
import "./globals.css"

// Self-hosted from Fontsource's variable fonts (latin), so no build depends on
// fonts.googleapis.com: Google sometimes answers in a shape Turbopack's
// next/font/google loader cannot resolve, which fails the build
// (vercel/next.js#99114).
const geist = localFont({
  src: "../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-sans",
})
const exo = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/exo/files/exo-latin-wght-normal.woff2", style: "normal" },
    { path: "../node_modules/@fontsource-variable/exo/files/exo-latin-wght-italic.woff2", style: "italic" },
  ],
  weight: "100 900",
  variable: "--font-exo",
})

export const metadata: Metadata = {
  title: "Al-Rahmah Complex",
  description: "Al-Rahmah Schools: admissions and staff portal.",
  // app/favicon.ico is picked up on its own; these add the PNG tab icon and the iPhone home-screen icon.
  // No install tags here: only the portal's pages carry them (lib/portal-app.ts, #497).
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: "/apple-touch-icon.png",
  },
}

export const viewport: Viewport = {
  themeColor: "#0900bb",
  // Android Chrome shrinks the page above the keyboard instead of laying the
  // keyboard over it, so a box near the foot of a form, or of the staff
  // shell's full-height stage, can always scroll above it. iOS ignores this.
  interactiveWidget: "resizes-content",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable, exo.variable)}>
      <body className="bg-slate-100 text-slate-800 min-h-screen antialiased">
        <PageLanguageProvider>{children}</PageLanguageProvider>
        {/* On a phone, the focused text box is kept above the keyboard on every page. */}
        <KeepFocusInView />
        <Toaster />
        <VercelInsights />
      </body>
    </html>
  )
}
