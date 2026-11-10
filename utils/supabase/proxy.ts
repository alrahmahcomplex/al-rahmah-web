import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { supabaseEnv } from "./env"

// Where a visitor with no session goes from a page that needs one.
function signInPage(pathname: string): string | null {
  if (pathname === "/staff" || pathname.startsWith("/staff/")) return "/login"
  if (pathname === "/discount-code/students" || pathname.startsWith("/discount-code/students/")) {
    return "/login"
  }
  return null
}

// Refreshes the Supabase session cookie on the auth-bound routes and sends visitors
// with no session away from staff pages and the Discount code students page.
// The guard here is optimistic only: the pages confirm the staff record or the
// agent themselves, through getStaffUser and getAgentUser.
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

  // Nothing may run between createServerClient and getClaims, or sessions can
  // drop at random. getClaims refreshes an expiring session the same way
  // getUser did, and (unlike getSession) verifies the token: locally with the
  // project's signing keys, or through the Auth server for a project still on
  // the legacy shared secret. No claims, an error or a throw is signed out.
  let signedIn = false
  try {
    const { data, error } = await supabase.auth.getClaims()
    signedIn = !error && typeof data?.claims.sub === "string" && data.claims.sub !== ""
  } catch (error) {
    console.error("Could not check the session token", error)
  }

  const signInFor = !signedIn ? signInPage(request.nextUrl.pathname) : null
  if (signInFor) {
    const redirectTo = request.nextUrl.clone()
    redirectTo.pathname = signInFor
    redirectTo.search = ""
    return NextResponse.redirect(redirectTo)
  }

  return response
}
