import type { NextRequest } from "next/server"

import { refreshSessionAndGuardStaffRoutes } from "@/utils/supabase/proxy"

export async function proxy(request: NextRequest) {
  return await refreshSessionAndGuardStaffRoutes(request)
}

export const config = {
  // Only the routes that read a session: staff, sign-in (#264) and its shared
  // reset page (#265), both under /auth since #497, the email-link landings
  // (/auth/confirm, /auth/callback), and the Discount code account pages
  // (#191). The proxy needs Supabase, so running it on public pages, the
  // Discount code sign-up page and /auth/forgot-password included, would let
  // a Supabase fault take them down too. That is why /auth is listed page by
  // page rather than as /auth/:path*.
  matcher: [
    "/staff/:path*",
    "/auth",
    "/auth/confirm",
    "/auth/callback",
    "/auth/reset-password",
    "/discount-code/set-password",
    "/discount-code/students/:path*",
  ],
}
