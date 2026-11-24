import { describe, expect, it } from "vitest"

import { formatTanzanianMobile, maskLogin } from "@/lib/mask-login"

describe("maskLogin and formatTanzanianMobile (#539)", () => {
  it("formats +255 and 07 Tanzanian mobile numbers cleanly", () => {
    expect(formatTanzanianMobile("+255712345123")).toBe("0712 345 123")
    expect(formatTanzanianMobile("255712345123")).toBe("0712 345 123")
    expect(formatTanzanianMobile("0712345123")).toBe("0712 345 123")
    expect(formatTanzanianMobile(null)).toBeNull()
  })

  it("masks mobile numbers to 0712 *** 123 and emails to first two characters", () => {
    expect(maskLogin({ phone: "+255712345123", email: "amina@example.test" })).toBe("0712 *** 123")
    expect(maskLogin({ phone: "0712345123" })).toBe("0712 *** 123")
    expect(maskLogin({ email: "amina@example.test" })).toBe("am***@example.test")
    expect(maskLogin({ email: "a@example.test" })).toBe("a***@example.test")
    expect(maskLogin({})).toBeNull()
  })
})
