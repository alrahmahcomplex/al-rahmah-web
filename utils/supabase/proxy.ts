import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { supabaseEnv } from "./env"

// Refreshes the Supabase session cookie on the auth-bound routes and sends visitors
// with no session away from staff pages. The guard here is optimistic only:
// the staff pages confirm the staff record themselves through getStaffUser.
export async function refreshSessionAndGuardStaffRoutes(request: NextRequest) {
  let response = NextResponse.next({ request })
  const { url, publishableKey } = supabaseEnv()

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // Nothing may run between createServerClient and getUser, or sessions can
  // drop at random. getUser (not getSession) revalidates the token.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && request.nextUrl.pathname.startsWith("/staff")) {
    const redirectTo = request.nextUrl.clone()
    redirectTo.pathname = "/login"
    redirectTo.search = ""
    return NextResponse.redirect(redirectTo)
  }

  return response
}
