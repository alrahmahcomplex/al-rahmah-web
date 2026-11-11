// The notice that tells a family the person who gave them a Discount code sees
// their students' admission progress (#182, PDPA 2022). A lead records which
// version accompanied its code in `leads.referral_notice_version`; null means
// no notice was shown, as for codes from before the notice and later imports.
// The database's check constraint lists the same versions.

// The notice under the Discount code field on the Admission form. Change the
// wording only together with a new version id, and add that id to the
// database's list. Never edit an old version's text: a lead that recorded it
// means the family saw exactly those words.
export const FORM_NOTICE_VERSION = "form_v2"

// form_v2 (#282): one sentence for one student or several, in the form's own
// word, "mwanafunzi".
export const FORM_NOTICE = {
  sw: "Mtu aliyekupa code hii ataona maendeleo ya udahili wa kila mwanafunzi kwenye fomu hii.",
  en: "The person who gave you this code will see the admission progress of each student on this form.",
} as const

// form_v1, shown until #282, when a form held one child. Leads saved before
// then still record it; the form no longer sends it.
export const FORM_NOTICE_V1_VERSION = "form_v1"

export const FORM_NOTICE_V1 = {
  sw: "Mtu aliyekupa code hii ataona maendeleo ya udahili wa mtoto wako.",
  en: "The person who gave you this code will see your child's admission progress.",
} as const

// Staff entering a code for a walk-in family see a reminder to tell them the
// same thing; the database records this version for every code staff set.
// Staff say it out loud, so the version records that they were reminded, not
// the exact words, and stays the same when the wording changes (#282).
export const STAFF_REMINDER_VERSION = "staff_reminder"

export const STAFF_REMINDER =
  "Tell the family: the person who gave them this code will see this student's admission progress."

export type ReferralNoticeVersion =
  | typeof FORM_NOTICE_VERSION
  | typeof FORM_NOTICE_V1_VERSION
  | typeof STAFF_REMINDER_VERSION
