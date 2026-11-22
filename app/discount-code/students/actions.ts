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

// A waiting code's page (#503 slice 4d-b) shows its finish mark once: the
// greeting is spent as soon as it has shown, so a refresh doesn't replay it.
export async function spendWelcome() {
  const jar = await cookies()
  jar.delete({ name: WELCOME_COOKIE, path: WELCOME_PATH })
}
