// The notice that tells a family the person who gave them a Discount code sees
// their child's admission progress (#182, PDPA 2022). A lead records which
// version accompanied its code in `leads.referral_notice_version`; null means
// no notice was shown, as for codes from before the notice and later imports.
// The database's check constraint lists the same versions.

// The notice under the Discount code field on the Admission form. Change the
// wording only together with a new version id, and add that id to the
// database's list.
export const FORM_NOTICE_VERSION = "form_v1"

export const FORM_NOTICE = {
  sw: "Mtu aliyekupa code hii ataona maendeleo ya udahili wa mtoto wako.",
  en: "The person who gave you this code will see your child's admission progress.",
} as const

// Staff entering a code for a walk-in family see a reminder to tell them the
// same thing; the database records this version for every code staff set.
export const STAFF_REMINDER_VERSION = "staff_reminder"

export const STAFF_REMINDER =
  "Tell the family: the person who gave them this code will see their child's admission progress."

export type ReferralNoticeVersion = typeof FORM_NOTICE_VERSION | typeof STAFF_REMINDER_VERSION
