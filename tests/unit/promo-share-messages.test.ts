import { describe, expect, it } from "vitest"

import { shareDay, shareMessage, shillings, withLink } from "@/app/staff/promo-codes/share-messages"

// The messages staff send parents with a Promo code (approved 28 Nov 2026).
// The one-parent message is the owner's own wording; these keep it exact.

const LINK = "https://alrahmahcomplex.or.tz/apply?ref=AS-135"
const CODE = { code: "AS-135", link: LINK, amount: 20_000 }

describe("a Promo code's share messages", () => {
  it("say the owner's words for one parent, in English and Kiswahili", () => {
    expect(shareMessage({ ...CODE, kind: "parent", language: "en", endsOn: null })).toBe(
      "Apply today using the link below to get 20,000/= off your child's interview fee at Al-Rahmah Schools. Instead of paying 50,000/= you pay only 30,000/= if you use this link. If the link doesn't open, just type the Discount code AS-135 on the form.\n\n" +
        `Remember, this discount is for a limited time, so apply today before it ends: ${LINK}`,
    )
    expect(shareMessage({ ...CODE, kind: "parent", language: "sw", endsOn: null })).toBe(
      "Omba nafasi leo kwa kutumia kiungo kilicho hapa chini ili kupata punguzo la 20,000/= kwenye ada ya usaili ya mtoto wako katika Shule za Al-Rahmah. Badala ya kulipa 50,000/=, utalipa 30,000/= pekee ikiwa utatumia kiungo hiki. Kiungo kisipofunguka, andika tu Code ya Punguzo AS-135 kwenye fomu.\n\n" +
        `Kumbuka, punguzo hili linapatikana kwa muda mfupi tu; hivyo, fanya ombi lako leo kabla muda haujaisha: ${LINK}`,
    )
  })

  it("name the last day when the code has one", () => {
    expect(shareMessage({ ...CODE, kind: "parent", language: "en", endsOn: "2026-12-31" })).toContain(
      `Remember, this discount ends on 31 Dec 2026, so apply today before it ends: ${LINK}`,
    )
    expect(shareMessage({ ...CODE, kind: "group", language: "sw", endsOn: "2026-12-31" })).toContain("linaisha tarehe 31 Desemba 2026")
    expect(shareMessage({ ...CODE, kind: "short", language: "en", endsOn: "2026-12-31" })).toContain(`Ends 31 Dec 2026, apply today: ${LINK}`)
  })

  it("give each message the code, the link at the end, and the fee the code leaves", () => {
    for (const kind of ["parent", "group", "short"] as const)
      for (const language of ["en", "sw"] as const) {
        const message = shareMessage({ ...CODE, amount: 15_000, kind, language, endsOn: null })
        expect(message, `${kind} ${language}`).toContain("AS-135")
        expect(message, `${kind} ${language}`).toContain("35,000/=")
        expect(message.endsWith(LINK), `${kind} ${language}`).toBe(true)
      }
  })

  it("writes amounts and days the way parents read them", () => {
    expect(shillings(50_000)).toBe("50,000/=")
    expect(shareDay("2027-01-05", "en")).toBe("5 Jan 2027")
    expect(shareDay("2027-01-05", "sw")).toBe("5 Januari 2027")
  })

  it("puts the link back at the end of an edited message", () => {
    expect(withLink("Apply with our code  ", LINK)).toBe(`Apply with our code ${LINK}`)
    expect(withLink("   ", LINK)).toBe(LINK)
  })
})
