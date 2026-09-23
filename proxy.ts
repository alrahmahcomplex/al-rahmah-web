import type { NextRequest } from "next/server"

import { refreshSessionAndGuardStaffRoutes } from "@/utils/supabase/proxy"

export async function proxy(request: NextRequest) {
  return await refreshSessionAndGuardStaffRoutes(request)
}

export const config = {
  // Only the routes that read the staff session. The proxy needs Supabase, so
  // running it on public pages would let a Supabase fault take them down too.
  matcher: ["/staff/:path*", "/login/:path*", "/auth/:path*"],
}
