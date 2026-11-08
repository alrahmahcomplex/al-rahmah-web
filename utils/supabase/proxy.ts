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

  // Nothing may run between createServerClient and getUser, or sessions can
  // drop at random. getUser (not getSession) revalidates the token.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const signInFor = !user ? signInPage(request.nextUrl.pathname) : null
  if (signInFor) {
    const redirectTo = request.nextUrl.clone()
    redirectTo.pathname = signInFor
    redirectTo.search = ""
    return NextResponse.redirect(redirectTo)
  }

  return response
}
