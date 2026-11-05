import type { NextRequest } from "next/server"

import { refreshSessionAndGuardStaffRoutes } from "@/utils/supabase/proxy"

export async function proxy(request: NextRequest) {
  return await refreshSessionAndGuardStaffRoutes(request)
}

export const config = {
  // Only the routes that read a session: staff, and the Discount code account
  // pages (#191). The proxy needs Supabase, so running it on public pages,
  // the Discount code sign-up page included, would let a Supabase fault take
  // them down too.
  matcher: [
    "/staff/:path*",
    "/login/:path*",
    "/auth/:path*",
    "/discount-code/sign-in",
    "/discount-code/set-password",
    "/discount-code/students/:path*",
  ],
}
