import type { RecordedResult, RecordResultError, RegisterError, Registration } from "@/lib/services/interviews"

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

// What the result form is told after Save. A refusal names the field it is
// about, so the form can mark it.
export type ResultField = "interview_date" | "result" | "score"

export type RecordOutcome =
  | { status: "saved"; message: string }
  | { status: "refused"; field: ResultField | null; message: string }

export function recordedOutcome({ firstRecording, changed }: RecordedResult): RecordOutcome {
  if (firstRecording) return { status: "saved", message: "Result recorded. The lead is Interviewed." }
  if (!changed) return { status: "saved", message: "Nothing was changed: the result is as it was." }
  return { status: "saved", message: "Result corrected. The history keeps the earlier values." }
}

export function recordOutcome(error: RecordResultError): RecordOutcome {
  switch (error) {
    case "incomplete":
      return {
        status: "refused",
        field: null,
        message: "Enter the interview date, choose Passed or Failed, and enter the score. A result is saved only with all three.",
      }
    case "score_out_of_range":
      return { status: "refused", field: "score", message: "Enter a score from 0 to 100." }
    case "score_too_precise":
      return { status: "refused", field: "score", message: "Enter the score with one decimal place at most, such as 72.5." }
    case "date_in_future":
      return { status: "refused", field: "interview_date", message: "The interview date can't be later than today." }
    case "date_before_registration":
      return {
        status: "refused",
        field: "interview_date",
        message: "The interview date can't be before the day the lead was registered for interview.",
      }
    case "lead_closed":
      return { status: "refused", field: null, message: "This lead is closed, so its interview result can't be changed." }
    case "forbidden":
      return { status: "refused", field: null, message: "Your role can't record this interview result." }
    case "not_found":
      return { status: "refused", field: null, message: "This interview could not be found. Reload the page." }
    case "unavailable":
      return {
        status: "refused",
        field: null,
        message: "The result could not be saved. Nothing was changed. Try again in a moment.",
      }
  }
}
