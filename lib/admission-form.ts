import { normalizeDiscountCode } from "@/lib/referral-link"
import { tanzaniaToday } from "@/lib/school-calendar"
import { DAY_OR_BOARDING, LEAD_CLASSES, RELATIONSHIPS, type NewContact, type NewStudent } from "@/lib/services/leads"

// The Admission form's shape and the checks it runs, shared by the page (so
// Continue names the field to fix) and the Server Action (which repeats every
// check, since anyone can post to it). The phone's format is checked only by
// the database, through create_lead.

export const MAX_CHILDREN = 8

export type AdmissionParent = NewContact
export type AdmissionChild = NewStudent

export type AdmissionForm = {
  // Made by the form when it mounts, kept until a confirmation shows.
  submissionKey: string
  parent: AdmissionParent
  children: AdmissionChild[]
  // One Discount code for every child on the form, normalized as the
  // database stores it. Absent when the parent left the field empty.
  discountCode?: string
}

// The fields a refusal can name. `child` says which child card, for the
// child's own fields.
export type ParentField = "contact_name" | "relationship" | "relationship_description" | "phone" | "whatsapp"
export type ChildField = "student_name" | "class_name" | "enrollment_year" | "day_or_boarding" | "duplicate_child"
export type FormField = ParentField | ChildField | "discount_code" | "children" | "submission_key" | "payload"

export type FieldProblem = { field: FormField; child: number | null }

// The years a parent may pick: this calendar year and next, in Tanzania time.
// Worked out on the server when the page renders, and again on submit.
export function admissionYears(now: Date = new Date()): [number, number] {
  const year = Number(tanzaniaToday(now).slice(0, 4))
  return [year, year + 1]
}

// Two children are the same child when their names match, ignoring case,
// outer spaces and runs of inner spaces, as the database compares them.
export function childNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

export function parentProblem(parent: AdmissionParent): FieldProblem | null {
  if (!parent.fullName.trim()) return { field: "contact_name", child: null }
  if (!(RELATIONSHIPS as readonly string[]).includes(parent.relationship)) return { field: "relationship", child: null }
  if (parent.relationship === "Other" && !parent.relationshipDescription?.trim()) {
    return { field: "relationship_description", child: null }
  }
  if (!parent.phone.trim()) return { field: "phone", child: null }
  return null
}

export function childrenProblem(children: AdmissionChild[], years: readonly number[]): FieldProblem | null {
  if (children.length < 1 || children.length > MAX_CHILDREN) return { field: "children", child: null }
  const seen = new Set<string>()
  for (const [index, child] of children.entries()) {
    if (!child.fullName.trim()) return { field: "student_name", child: index }
    if (!(LEAD_CLASSES as readonly string[]).includes(child.className)) return { field: "class_name", child: index }
    if (!years.includes(child.enrollmentYear)) return { field: "enrollment_year", child: index }
    if (!(DAY_OR_BOARDING as readonly string[]).includes(child.dayOrBoarding)) {
      return { field: "day_or_boarding", child: index }
    }
    const key = childNameKey(child.fullName)
    if (seen.has(key)) return { field: "duplicate_child", child: index }
    seen.add(key)
  }
  return null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TEXT = 200

function text(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_TEXT ? value : null
}

function optionalText(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined
  return text(value)
}

// Reads the form the page posted (JSON in the `form` field) into its shape,
// trimmed, and runs every check. Anything that isn't the shape the page
// sends is `payload`.
export function parseAdmissionForm(
  raw: unknown,
  years: readonly number[],
): { ok: true; data: AdmissionForm } | { ok: false; error: FieldProblem } {
  const payload: FieldProblem = { field: "payload", child: null }
  let value: unknown
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : null
  } catch {
    return { ok: false, error: payload }
  }
  if (!value || typeof value !== "object") return { ok: false, error: payload }
  const { submissionKey, parent, children, discountCode } = value as Record<string, unknown>

  if (typeof submissionKey !== "string" || !UUID.test(submissionKey)) {
    return { ok: false, error: { field: "submission_key", child: null } }
  }
  if (!parent || typeof parent !== "object" || !Array.isArray(children)) return { ok: false, error: payload }

  const p = parent as Record<string, unknown>
  const fullName = text(p.fullName)
  const relationship = text(p.relationship)
  const description = optionalText(p.relationshipDescription)
  const phone = text(p.phone)
  const whatsapp = optionalText(p.whatsapp)
  if (fullName === null || relationship === null || description === null || phone === null || whatsapp === null) {
    return { ok: false, error: payload }
  }
  const cleanParent: AdmissionParent = {
    fullName: fullName.trim(),
    relationship: relationship as AdmissionParent["relationship"],
    phone: phone.trim(),
  }
  if (relationship === "Other" && description?.trim()) cleanParent.relationshipDescription = description.trim()
  if (whatsapp?.trim()) cleanParent.whatsapp = whatsapp.trim()

  if (children.length > MAX_CHILDREN) return { ok: false, error: { field: "children", child: null } }
  const cleanChildren: AdmissionChild[] = []
  for (const child of children) {
    if (!child || typeof child !== "object") return { ok: false, error: payload }
    const c = child as Record<string, unknown>
    const name = text(c.fullName)
    const className = text(c.className)
    const dayOrBoarding = text(c.dayOrBoarding)
    if (name === null || className === null || dayOrBoarding === null || typeof c.enrollmentYear !== "number") {
      return { ok: false, error: payload }
    }
    cleanChildren.push({
      fullName: name.trim(),
      className: className as AdmissionChild["className"],
      enrollmentYear: c.enrollmentYear,
      dayOrBoarding: dayOrBoarding as AdmissionChild["dayOrBoarding"],
    })
  }

  const problem = parentProblem(cleanParent) ?? childrenProblem(cleanChildren, years)
  if (problem) return { ok: false, error: problem }

  // Optional, and refused only when it isn't a code at all: a code no agent
  // holds is still kept, for staff to fix.
  const typedCode = optionalText(discountCode)
  if (typedCode === null) return { ok: false, error: payload }
  const code = typedCode?.trim() ? normalizeDiscountCode(typedCode) : undefined
  if (code === null) return { ok: false, error: { field: "discount_code", child: null } }

  const form: AdmissionForm = { submissionKey: submissionKey.toLowerCase(), parent: cleanParent, children: cleanChildren }
  if (code) form.discountCode = code
  return { ok: true, data: form }
}
