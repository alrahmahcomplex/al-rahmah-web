"use client"

import type { ReactNode } from "react"

import { Disclosure as KitDisclosure } from "@/components/kit"

// The disclosure: the kit's plain fold-open section (#358), collapsed at first.
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <KitDisclosure label={label} variant="plain">
      {children}
    </KitDisclosure>
  )
}
