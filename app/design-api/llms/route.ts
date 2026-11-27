import { checkDesignKey } from "@/lib/design-site/access"
import { llmsText, partOrHelp } from "@/lib/design-site/content"

// llms.txt (design site, prototype v6): the whole design system as one
// plain-text page, for an AI that can only open a link. The password comes in
// the link (?key=), the owner's choice: the page holds no family data.
// ?part=<id> gives one part's rules and code. design. serves it at /llms.txt.

export const dynamic = "force-dynamic"

const HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" }

const REFUSALS = {
  wrong: [401, "This link needs the design site's password: add ?key=<the password> to it."],
  tries: [429, "Too many wrong passwords. Wait 10 minutes, then try again."],
  unset: [503, "The design site isn't set up yet."],
} as const

export async function GET(request: Request) {
  const url = new URL(request.url)
  const access = checkDesignKey(url.searchParams.get("key"), request.headers)
  if (access !== "open") {
    const [status, message] = REFUSALS[access]
    return new Response(message, { status, headers: HEADERS })
  }
  const part = url.searchParams.get("part")
  if (part) {
    const found = await partOrHelp(part)
    return new Response(found.text, { status: found.ok ? 200 : 404, headers: HEADERS })
  }
  return new Response(await llmsText(url.origin), { headers: HEADERS })
}
