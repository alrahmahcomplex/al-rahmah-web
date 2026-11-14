"use client"

import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

// The disclosure, until #358 brings the kit's (see README.md): today's
// Collapsible behind a ghost button with a turning chevron, collapsed at first.
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="group -ml-2.5" />}>
        <ChevronRightIcon data-icon="inline-start" className="transition-transform group-aria-expanded:rotate-90" />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
