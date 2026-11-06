import { buildWhatsAppLink } from "@/lib/whatsapp"

// Share on WhatsApp for a Discount code holder: the shared WhatsApp module's
// link with the text typed and no number, so the sender picks the chat (#10).
// Null when the module refuses the text, and the page then shows no share
// button.
export function discountCodeShareLink(message: string): string | null {
  const link = buildWhatsAppLink(message)
  return link.ok ? link.data : null
}
