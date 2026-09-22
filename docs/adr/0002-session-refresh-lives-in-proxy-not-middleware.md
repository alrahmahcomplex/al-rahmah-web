# 2. Session refresh lives in proxy.ts, not middleware.ts

Date: 2026-09-22

## Status

Accepted

## Context

The Supabase SSR pattern refreshes the auth cookie in Next.js middleware, and the
archived photo matcher this app grew from did exactly that in `middleware.ts`.

Next.js 16 renamed the convention. Its upgrade guide states the `middleware`
filename is deprecated and renamed to `proxy`, that the named export should be
renamed too, and that the `edge` runtime is not supported there — `proxy` runs on
Node.js and that cannot be configured.

## Decision

The root file is `proxy.ts`, exporting `proxy`, and the Supabase helper beside it is
`utils/supabase/proxy.ts` rather than `utils/supabase/middleware.ts`, so the two
names agree.

Its job stays deliberately small: refresh the session cookie, and redirect visitors
with no session away from `/staff`. It performs no allowlist check, because the
Next.js documentation is explicit that Proxy is for optimistic checks and not a full
session-management or authorization solution. Authorization lives where ADR 1 puts
it.

## Consequences

Anyone following Supabase's published Next.js guide will find the file under a
different name than the guide uses; this ADR is the pointer. Filenames and exports
in the Supabase docs will need translating until they catch up with Next.js 16.

Because `proxy` is Node-only, session refresh no longer runs on the edge runtime.
This app has no edge requirement, and deployment is Vercel's Node runtime.
