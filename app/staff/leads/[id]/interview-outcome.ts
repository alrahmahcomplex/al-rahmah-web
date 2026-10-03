import type { RegisterError, Registration } from "@/lib/services/interviews"

// What the interview panel is told after Register for interview.
export type RegisterOutcome =
  | { status: "registered"; message: string }
  | { status: "refused"; message: string }

export function registeredOutcome({ serialNumber, enrollmentYear }: Registration): RegisterOutcome {
  return { status: "registered", message: `Registered for interview. The S/N is ${serialNumber} for ${enrollmentYear}.` }
}

// Turns what the interview module refused into a plain sentence. The codes
// never reach the screen.
export function registerOutcome(error: RegisterError): RegisterOutcome {
  switch (error) {
    case "already_registered":
      return {
        status: "refused",
        message: "This lead is already registered for interview. Reload the page to see its S/N.",
      }
    case "lead_closed":
      return { status: "refused", message: "This lead is closed, so it can't be registered for interview." }
    case "lead_enrolled":
      return { status: "refused", message: "This lead is already Enrolled, so it doesn't need an interview." }
    case "forbidden":
      return { status: "refused", message: "Your role can't register leads for interview." }
    case "not_found":
      return { status: "refused", message: "This lead could not be found. Reload the page." }
    case "unavailable":
      return {
        status: "refused",
        message: "The registration could not be saved. Nothing was changed. Try again in a moment.",
      }
  }
}
