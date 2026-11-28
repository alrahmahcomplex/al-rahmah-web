import { checkDesignKey } from "@/lib/design-site/access"
import { answerBody } from "@/lib/design-site/mcp"

// The design site's MCP server (prototype v6), Streamable HTTP without
// sessions: POST a JSON-RPC message with "Authorization: Bearer <password>",
// get JSON back. No stream to open (GET), nothing to end (DELETE). Read only.
// design. serves it at /mcp.

export const dynamic = "force-dynamic"

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" }

function refuse(status: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }), {
    status,
    headers: { ...JSON_HEADERS, ...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="alrahmah-design"' } : {}) },
  })
}

export async function POST(request: Request) {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null
  const access = await checkDesignKey(bearer, request.headers)
  if (access === "wrong") return refuse(401, "Send the design site's password: Authorization: Bearer <the password>.")
  if (access === "tries") return refuse(429, "Too many wrong passwords. Wait 10 minutes, then try again.")
  if (access === "unset") return refuse(503, "The design site isn't set up yet.")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: the body is not JSON." } }), { status: 400, headers: JSON_HEADERS })
  }
  const reply = await answerBody(body)
  if (reply === null) return new Response(null, { status: 202 })
  return new Response(JSON.stringify(reply), { headers: JSON_HEADERS })
}

const NO_STREAM = () => new Response(null, { status: 405, headers: { Allow: "POST" } })
export const GET = NO_STREAM
export const DELETE = NO_STREAM
