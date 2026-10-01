import type { Metadata } from "next"
import localFont from "next/font/local"

import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

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
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable, exo.variable)}>
      <body className="bg-slate-100 text-slate-800 min-h-screen antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  )
}
