import type { Metadata } from "next"
import { Exo, Geist } from "next/font/google"

import { Toaster } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

import "./globals.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })
const exo = Exo({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
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
