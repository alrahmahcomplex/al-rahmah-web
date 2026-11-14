import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { payloadHash } from "@/lib/services/admission-form"

// The submission key's hash. A page loaded before a deploy retries with the
// same key, so a one-box form must hash exactly as it did before names came
// in parts (#400). The digests are the ones the code on main gave before
// that change; any change to how a one-box form is hashed fails here.

const parent = { fullName: "Amina Fixture", relationship: "Mother" as const, phone: "0700 000 900" }
const child = { fullName: "Zawadi Fixture", className: "STD 2" as const, enrollmentYear: 2027, dayOrBoarding: "Day" as const }

describe("the Admission form's submission hash", () => {
  it("hashes a one-box form as before names came in parts", () => {
    expect(payloadHash({ parent, children: [child] })).toBe("fd4fbdd8be10971ca96aa717d71b6e909a6893d7a48cd5247e37f6211c295d1c")
    expect(
      payloadHash({
        discountCode: "AAN-132",
        parent: { ...parent, relationship: "Other", relationshipDescription: "Aunt", whatsapp: "0700 000 901" },
        children: [child, { fullName: "Baraka Fixture", className: "KG 1", enrollmentYear: 2027, dayOrBoarding: "Boarding" }],
      }),
    ).toBe("096f87a185a79f40216108cefe5548bf183fceec9316af2f230f800e5f107163")
  })

  it("tells a form in parts from the one-box form with the same full names", () => {
    const oneBox = payloadHash({ parent, children: [child] })
    const inParts = payloadHash({
      parent: { ...parent, nameParts: { firstName: "Amina", middleName: "Juma", lastName: "Fixture" } },
      children: [{ ...child, nameParts: { firstName: "Zawadi", fatherFirst: "Hassan", fatherMiddle: "Ali", fatherLast: "Fixture" } }],
    })
    expect(inParts).not.toBe(oneBox)
  })
})
