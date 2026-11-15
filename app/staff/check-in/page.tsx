import { redirect } from "next/navigation"

// Check-in starts on Home now (#323): its search bar finds the family by
// Admission Number. An old link or bookmark lands there.
export default function CheckInPage() {
  redirect("/staff")
}
