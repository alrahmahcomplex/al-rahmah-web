import type { Metadata } from "next"

import { PageHeader } from "@/components/kit"

import { ConnectCards } from "./connect-cards"

export const metadata: Metadata = { title: "Connect an AI" }

// Connect an AI (prototype v6): the two ways in for an AI, llms.txt with the
// password in the link and the MCP server with the password in a header.
// Static; the copy buttons fetch the password once the page is live.
export default function ConnectPage() {
  return (
    <>
      <PageHeader title="Connect an AI" subtitle="Two ways in. Both use the same password, and both give only what is on the Design system page." />
      <ConnectCards />
    </>
  )
}
