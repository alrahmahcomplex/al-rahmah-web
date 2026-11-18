import { LoadingState } from "@/components/kit"

// Check-in while the family is read: "Finding the family…", as prototype v38 shows it.
export default function Loading() {
  return <LoadingState label="Finding the family…" />
}
