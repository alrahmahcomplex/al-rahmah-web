import { describe, expect, it } from "vitest"

import { buildWhatsAppLink, formatScore, renderResultMessage, type ResultMessageInput } from "@/lib/result-messages"

// Invented values only. The office phone is passed as a value, as callers pass
// OFFICE_PHONE, so these tests never import the server-only module.
const VALUES = {
  parentName: "Mwanaidi Juma Hassan",
  studentName: "Zawadi Salim",
  score: 78.5,
  admissionNumber: "ADMSN-40719",
  className: "FORM 1",
  enrollmentYear: 2027,
  officePhone: "+255 673 526 644",
}

function render(input: Partial<ResultMessageInput> & Pick<ResultMessageInput, "channel" | "result">) {
  const rendered = renderResultMessage({ ...VALUES, ...input })
  if (!rendered.ok) throw new Error(`refused: ${rendered.error}`)
  return rendered.data
}

// The four templates as approved on #11, filled in by hand with VALUES.
const WHATSAPP_PASSED = `Assalaam Alaykum Mwanaidi Juma Hassan,

*Hongera sana!* 🎉 Tuna furaha kubwa kukujulisha kwamba *Zawadi Salim* amefaulu usaili wa kujiunga na Al-Rahmah Schools.

- *Matokeo:* Amefaulu
- *Alama:* 78.5%
- *Darasa:* FORM 1, 2027
- *Namba ya Udahili:* ADMSN-40719

*Hatua inayofuata:* Kamilisha usajili kwa kulipa ada ya shule katika ofisi yetu ya udahili.

Tunamkaribisha Zawadi Salim kwa mikono miwili katika familia ya Al-Rahmah.

_Ofisi ya Udahili, Al-Rahmah Schools_`

const WHATSAPP_FAILED = `Assalaam Alaykum Mwanaidi Juma Hassan,

Asante kwa kumleta *Zawadi Salim* kufanya usaili wa kujiunga na Al-Rahmah Schools. Tunathamini sana imani yenu kwetu.

Kwa masikitiko, safari hii Zawadi Salim hakufaulu usaili.

- *Matokeo:* Hakufaulu
- *Alama:* 78.5%
- *Namba ya Udahili:* ADMSN-40719

*Hatua inayofuata:* Tafadhali wasiliana na ofisi yetu ya udahili kupitia +255 673 526 644 ili tuzungumze pamoja kuhusu njia bora kwa Zawadi Salim.

_Ofisi ya Udahili, Al-Rahmah Schools_`

const SMS_PASSED =
  "Assalaam Alaykum Mwanaidi Juma Hassan. Hongera! Zawadi Salim amefaulu usaili wa Al-Rahmah Schools kwa alama 78.5%. Namba ya Udahili: ADMSN-40719. Hatua inayofuata: kamilisha usajili kwa kulipa ada ofisini. - Ofisi ya Udahili"

const SMS_FAILED =
  "Assalaam Alaykum Mwanaidi Juma Hassan. Asante kwa kumleta Zawadi Salim kwenye usaili wa Al-Rahmah Schools. Kwa masikitiko, hakufaulu; alama 78.5%. Namba ya Udahili: ADMSN-40719. Tafadhali wasiliana na ofisi ya udahili: +255 673 526 644. - Ofisi ya Udahili"

const EMOJI = /\p{Extended_Pictographic}/gu

describe("renderResultMessage", () => {
  it.each([
    ["whatsapp", "passed", WHATSAPP_PASSED, "whatsapp_passed_v1"],
    ["whatsapp", "failed", WHATSAPP_FAILED, "whatsapp_failed_v1"],
    ["sms", "passed", SMS_PASSED, "sms_passed_v1"],
    ["sms", "failed", SMS_FAILED, "sms_failed_v1"],
  ] as const)("renders the approved %s %s message exactly", (channel, result, expected, templateId) => {
    const message = render({ channel, result })
    expect(message.text).toBe(expected)
    expect(message.templateId).toBe(templateId)
  })

  it("gives the class and enrollment year on Passed and never the office phone", () => {
    for (const channel of ["whatsapp", "sms"] as const) {
      const { text } = render({ channel, result: "passed", className: "STD 5", enrollmentYear: 2028 })
      expect(text).not.toContain("+255 673 526 644")
      expect(text).not.toMatch(/\{\w+\}/)
    }
    expect(render({ channel: "whatsapp", result: "passed", className: "STD 5", enrollmentYear: 2028 }).text).toContain(
      "*Darasa:* STD 5, 2028",
    )
  })

  it("gives the office phone on Failed and never the class or year", () => {
    for (const channel of ["whatsapp", "sms"] as const) {
      const { text } = render({ channel, result: "failed", className: "STD 5", enrollmentYear: 2028 })
      expect(text).toContain("+255 673 526 644")
      expect(text).not.toContain("STD 5")
      expect(text).not.toContain("2028")
      expect(text).not.toMatch(/\{\w+\}/)
    }
  })

  it("never mentions a retake on Failed", () => {
    for (const channel of ["whatsapp", "sms"] as const) {
      const { text } = render({ channel, result: "failed" })
      expect(text.toLowerCase()).not.toMatch(/rudia|tena|retake/)
    }
  })

  it("carries the Next action as fixed text", () => {
    expect(render({ channel: "whatsapp", result: "passed" }).text).toContain("*Hatua inayofuata:* Kamilisha usajili")
    expect(render({ channel: "whatsapp", result: "failed" }).text).toContain(
      "*Hatua inayofuata:* Tafadhali wasiliana na ofisi yetu ya udahili",
    )
    expect(render({ channel: "sms", result: "passed" }).text).toContain("Hatua inayofuata: kamilisha usajili")
  })

  it("puts the only emoji, one 🎉, on the WhatsApp Passed message", () => {
    expect(render({ channel: "whatsapp", result: "passed" }).text.match(EMOJI)).toEqual(["🎉"])
    expect(render({ channel: "whatsapp", result: "failed" }).text.match(EMOJI)).toBeNull()
    expect(render({ channel: "sms", result: "passed" }).text.match(EMOJI)).toBeNull()
    expect(render({ channel: "sms", result: "failed" }).text.match(EMOJI)).toBeNull()
  })

  it("fills a name with $ characters literally", () => {
    const { text } = render({ channel: "sms", result: "passed", parentName: "Asha $& $1 $$" })
    expect(text.startsWith("Assalaam Alaykum Asha $& $1 $$. Hongera!")).toBe(true)
  })

  it("keeps the WhatsApp message under 1,000 characters with 100-character names", () => {
    const longName = "M".repeat(100)
    for (const result of ["passed", "failed"] as const) {
      const { text } = render({ channel: "whatsapp", result, parentName: longName, studentName: longName })
      expect(text.length).toBeLessThan(1000)
    }
  })

  it("refuses a WhatsApp message over 1,000 characters", () => {
    const rendered = renderResultMessage({
      ...VALUES,
      channel: "whatsapp",
      result: "passed",
      parentName: "M".repeat(400),
      studentName: "Z".repeat(400),
    })
    expect(rendered).toEqual({ ok: false, error: "too_long" })
  })

  it("keeps the SMS all GSM-7 and in at most two segments with long names", () => {
    const longName = "Mwanaisha Abdulrahman Mohamedali Khamis"
    for (const result of ["passed", "failed"] as const) {
      const message = render({ channel: "sms", result, parentName: longName, studentName: longName })
      if (message.channel !== "sms") throw new Error("expected an SMS")
      expect(message.gsm7).toBe(true)
      expect(message.segments).toBeLessThanOrEqual(2)
    }
  })

  it("counts the approved SMS texts as GSM-7 in two segments", () => {
    for (const result of ["passed", "failed"] as const) {
      const message = render({ channel: "sms", result })
      if (message.channel !== "sms") throw new Error("expected an SMS")
      expect(message).toMatchObject({ gsm7: true, segments: 2 })
    }
  })

  it("counts more segments when a name has a character basic phones can't show", () => {
    for (const parentName of ["Mwanaidi O’Brien", "Rehema Kêllo"]) {
      const message = render({ channel: "sms", result: "failed", parentName })
      if (message.channel !== "sms") throw new Error("expected an SMS")
      expect(message.gsm7).toBe(false)
      expect(message.segments).toBeGreaterThan(2)
    }
  })

  it("treats é as GSM-7, since the basic GSM alphabet has it", () => {
    const message = render({ channel: "sms", result: "failed", parentName: "Renée Mushi" })
    if (message.channel !== "sms") throw new Error("expected an SMS")
    expect(message).toMatchObject({ gsm7: true, segments: 2 })
  })

  it("counts a GSM-7 extension character as two", () => {
    // 226 characters fit in two segments (306 septets); a name of 80 `[`
    // adds 160 septets and pushes it to three.
    const plain = render({ channel: "sms", result: "passed", parentName: "A".repeat(80) })
    const extended = render({ channel: "sms", result: "passed", parentName: "[".repeat(80) })
    if (plain.channel !== "sms" || extended.channel !== "sms") throw new Error("expected an SMS")
    expect(plain).toMatchObject({ gsm7: true, segments: 2 })
    expect(extended).toMatchObject({ gsm7: true, segments: 3 })
  })
})

describe("formatScore", () => {
  it.each([
    [78, "78%"],
    [78.5, "78.5%"],
    [0, "0%"],
    [100, "100%"],
    [78.0, "78%"],
    [64.30000000000001, "64.3%"],
  ])("formats %s as %s", (score, expected) => {
    expect(formatScore(score)).toBe(expected)
  })
})

describe("buildWhatsAppLink", () => {
  it("builds a wa.me link with the text percent-encoded", () => {
    expect(buildWhatsAppLink("255712345678", "Habari yako")).toEqual({
      ok: true,
      data: "https://wa.me/255712345678?text=Habari%20yako",
    })
  })

  it("round-trips awkward characters and the emoji unchanged", () => {
    const text = "Mama O'Neil & Baba #1: 50% + 🎉\n*Hongera*"
    const link = buildWhatsAppLink("255612345678", text)
    if (!link.ok) throw new Error("refused")
    const url = new URL(link.data)
    expect(url.origin + url.pathname).toBe("https://wa.me/255612345678")
    // A raw `+` would arrive as a space, and a raw `&` or `#` would cut the text.
    expect(link.data.split("?text=")[1]).not.toMatch(/[ +&#\n]/)
    expect(decodeURIComponent(link.data.split("?text=")[1])).toBe(text)
    expect(url.searchParams.get("text")).toBe(text)
  })

  it.each([
    ["0712345678"],
    ["+255712345678"],
    ["255223456789"],
    ["25571234567"],
    ["2557123456789"],
    ["254712345678"],
    ["447712345678"],
    [" 255712345678"],
    ["255712345678\n"],
  ])("refuses %j", (digits) => {
    expect(buildWhatsAppLink(digits, "Habari")).toEqual({ ok: false, error: "invalid_number" })
  })
})
