"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { WELCOME_COOKIE, WELCOME_PATH } from "./welcome"

// "Ona Wanafunzi Niliowaleta" on the one-time greeting: the greeting is spent,
// and the dashboard opens at the same address.
export async function continueToStudents() {
  const jar = await cookies()
  jar.delete({ name: WELCOME_COOKIE, path: WELCOME_PATH })
  redirect(WELCOME_PATH)
}
