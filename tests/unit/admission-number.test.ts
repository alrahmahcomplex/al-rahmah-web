import { describe, expect, it } from "vitest"

import { parseAdmissionNumber } from "@/lib/services/leads"

describe("parseAdmissionNumber", () => {
  it("reads the number however staff type it", () => {
    for (const typed of ["ADMSN-40719", "admsn-40719", "Admsn-40719", "40719", "  ADMSN-40719  ", " 40719\t"]) {
      expect(parseAdmissionNumber(typed), JSON.stringify(typed)).toBe("ADMSN-40719")
    }
  })

  it("reads nothing else as an Admission Number", () => {
    for (const typed of ["", "   ", "4071", "407190", "ADMSN-", "ADMSN-4071a", "ADM-40719", "ADMSN 40719", "40 719"]) {
      expect(parseAdmissionNumber(typed), JSON.stringify(typed)).toBeNull()
    }
  })
})
