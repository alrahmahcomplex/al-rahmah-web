import type { IconName } from "@/components/icons"
import type { DiscountKind } from "@/lib/services/discounts"

import { discountLabel } from "../applicants/[id]/discount-outcome"

// What the bell's popover lists (#322): each Pending Discount and Reopening
// request the staff member may decide, newest first, each linking to the
// screen where it is decided.

export type BellRequest = { key: string; icon: IconName; title: string; caption: string; href: string; requestedAt: string }

type Discount = { id: string; studentName: string; kind: DiscountKind; note: string; requestedAt: string }
type Reopening = { id: string; studentName: string; reason: string; requestedAt: string }

// A note or reason is cut here so a row stays two lines.
const CAPTION_TEXT_MAX = 60

function short(text: string): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length <= CAPTION_TEXT_MAX ? line : `${line.slice(0, CAPTION_TEXT_MAX - 1).trimEnd()}…`
}

function caption(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join(" · ")
}

export function bellRequests(discounts: readonly Discount[], reopenings: readonly Reopening[]): BellRequest[] {
  return [
    ...discounts.map((request) => ({
      key: `discount-${request.id}`,
      icon: "discounts" as const,
      title: "New discount request",
      caption: caption(request.studentName, discountLabel(request.kind), short(request.note)),
      href: "/staff/discounts",
      requestedAt: request.requestedAt,
    })),
    ...reopenings.map((request) => ({
      key: `reopening-${request.id}`,
      icon: "reopen" as const,
      title: "New reopening request",
      caption: caption(request.studentName, short(request.reason)),
      href: "/staff/reopenings",
      requestedAt: request.requestedAt,
    })),
  ].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
}
