import type { NextRequest } from "next/server"

import { refreshSessionAndGuardStaffRoutes } from "@/utils/supabase/proxy"

export async function proxy(request: NextRequest) {
  return await refreshSessionAndGuardStaffRoutes(request)
}

export const config = {
  matcher: [
    // Everything except Next.js assets, the favicon and static images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
