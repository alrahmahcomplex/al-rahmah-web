import "server-only"

// The school office's phone number, as families see it on the Admission form's
// confirmation and in result messages. One place, so it changes once.
export const OFFICE_PHONE = "+255 673 526 644"

// The same number as an agent dials it in an SMS: 0673 526 644.
export function localOfficePhone(): string {
  return `0${OFFICE_PHONE.replace(/^\+255\s*/, "")}`
}
