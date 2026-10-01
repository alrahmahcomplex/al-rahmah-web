"use server"

import { cookies } from "next/headers"

import { isLanguage, LANGUAGE_COOKIE } from "@/lib/language"

const ONE_YEAR = 60 * 60 * 24 * 365

// The language switch's action. Setting the cookie re-renders the current page
// in place, so a form on the page keeps what the visitor typed.
export async function setLanguage(formData: FormData): Promise<void> {
  const lang = formData.get("lang")
  if (!isLanguage(lang)) return

  const jar = await cookies()
  jar.set(LANGUAGE_COOKIE, lang, {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  })
}
