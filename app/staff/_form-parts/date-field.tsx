"use client"

import { DateField as KitDateField } from "@/components/kit"

// The date field: the kit's DateField (#358). Typed day first, posting
// YYYY-MM-DD with its form, as the native input did.
export function DateField({ id, name, defaultValue }: { id: string; name: string; defaultValue: string }) {
  return <KitDateField id={id} name={name} defaultValue={defaultValue} />
}
