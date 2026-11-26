// The columns a student export can carry, in CSV order, with their tier.
// Shared between lib/services/student-export.ts and the Audit page's plain
// words so export_log entries name each column the way the export does.

export type ExportTier = "view" | "contact" | "full"

export const EXPORT_COLUMNS = [
  { key: "admission_number", header: "Admission Number", tier: "view" },
  { key: "student_name", header: "Student name", tier: "view" },
  { key: "class_name", header: "Class", tier: "view" },
  { key: "enrollment_year", header: "Enrollment year", tier: "view" },
  { key: "day_or_boarding", header: "Day or boarding", tier: "view" },
  // The child's answer, Boy or Girl; empty when there is none (#449).
  { key: "gender", header: "Boy or girl", tier: "view" },
  { key: "status", header: "Status", tier: "view" },
  { key: "status_since", header: "Status since", tier: "view" },
  { key: "visit_date", header: "Visit date", tier: "view" },
  { key: "discount_code", header: "Discount code", tier: "view" },
  { key: "discount_holder", header: "Agent or Promo name", tier: "view" },
  { key: "pre_form_one", header: "Pre-Form One", tier: "view" },
  { key: "imported", header: "Imported", tier: "view" },
  { key: "guardian_name", header: "Parent name", tier: "contact" },
  { key: "relationship", header: "Relationship", tier: "contact" },
  { key: "guardian_phone", header: "Parent phone", tier: "contact" },
  { key: "guardian_whatsapp", header: "WhatsApp", tier: "contact" },
  { key: "interview_fee_status", header: "Interview fee status", tier: "full" },
  { key: "interview_fee_amount", header: "Interview fee (TZS)", tier: "full" },
  { key: "interview_result", header: "Interview result", tier: "full" },
  { key: "interview_score", header: "Interview score", tier: "full" },
  { key: "school_fee", header: "School fee (TZS)", tier: "full" },
  { key: "school_fee_paid", header: "School fee paid (TZS)", tier: "full" },
  { key: "school_fee_discount", header: "School fee discount", tier: "full" },
  { key: "follow_up_notes", header: "Follow-up notes", tier: "full" },
  { key: "declined_reason", header: "Declined reason", tier: "full" },
  { key: "declined_explanation", header: "Declined explanation", tier: "full" },
  { key: "closure", header: "Closure", tier: "full" },
  { key: "history_count", header: "History entries", tier: "full" },
] as const satisfies readonly { key: string; header: string; tier: ExportTier }[]

export type ExportColumn = (typeof EXPORT_COLUMNS)[number]["key"]
