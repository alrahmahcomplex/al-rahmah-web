import { describe, expect, it } from "vitest"

import {
  formatScore,
  renderResultMessage,
  RESULT_TEMPLATES,
  SCHOOL_CONTACTS,
  schoolLevelOf,
  type ResultMessageInput,
} from "@/lib/result-messages"

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

// The templates sent now, filled in by hand with VALUES: #11's Passed
// messages, and the Conditional and Failed (version 2) messages the owner
// approved on 2026-11-27. FORM 1 is secondary, so they give the secondary
// school's number.
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

*Hatua inayofuata:* Tafadhali wasiliana na shule kupitia +255 677 990 033 ili tuzungumze pamoja kuhusu njia bora kwa Zawadi Salim.

_Ofisi ya Udahili, Al-Rahmah Schools_`

const SMS_PASSED =
  "Assalaam Alaykum Mwanaidi Juma Hassan. Hongera! Zawadi Salim amefaulu usaili wa Al-Rahmah Schools kwa alama 78.5%. Namba ya Udahili: ADMSN-40719. Hatua inayofuata: kamilisha usajili kwa kulipa ada ofisini. - Ofisi ya Udahili"

const SMS_FAILED =
  "Assalaam Alaykum Mwanaidi Juma Hassan. Asante kwa kumleta Zawadi Salim kwenye usaili wa Al-Rahmah Schools. Kwa masikitiko, hakufaulu; alama 78.5%. Namba ya Udahili: ADMSN-40719. Tafadhali wasiliana na shule: +255 677 990 033. - Ofisi ya Udahili"

const WHATSAPP_CONDITIONAL = `Assalaam Alaykum Mwanaidi Juma Hassan,

Asante kwa kumleta *Zawadi Salim* kufanya usaili wa kujiunga na Al-Rahmah Schools.

Zawadi Salim hakufikia alama za kufaulu usaili, lakini tunafurahi kukujulisha kwamba *tutampokea kwa masharti*.

- *Matokeo:* Amepokelewa kwa masharti
- *Alama:* 78.5%
- *Darasa:* FORM 1, 2027
- *Namba ya Udahili:* ADMSN-40719

*Hatua inayofuata:* Fika ofisi ya Mkuu wa Shule ya Sekondari kusaini mkataba. Baada ya hapo, kamilisha usajili kwa kulipa ada ya shule. Kwa maswali piga +255 677 990 033.

_Ofisi ya Udahili, Al-Rahmah Schools_`

const SMS_CONDITIONAL =
  "Assalaam Alaykum Mwanaidi Juma Hassan. Zawadi Salim hakufaulu usaili wa Al-Rahmah Schools (alama 78.5%), lakini tutampokea kwa masharti. Namba ya Udahili: ADMSN-40719. Hatua inayofuata: fika ofisi ya Mkuu wa Shule ya Sekondari kusaini mkataba, kisha ulipe ada. Simu: +255 677 990 033. - Ofisi ya Udahili"

const EMOJI = /\p{Extended_Pictographic}/gu

describe("renderResultMessage", () => {
  it.each([
    ["whatsapp", "passed", WHATSAPP_PASSED, "whatsapp_passed_v1"],
    ["whatsapp", "conditional", WHATSAPP_CONDITIONAL, "whatsapp_conditional_v1"],
    ["whatsapp", "failed", WHATSAPP_FAILED, "whatsapp_failed_v2"],
    ["sms", "passed", SMS_PASSED, "sms_passed_v1"],
    ["sms", "conditional", SMS_CONDITIONAL, "sms_conditional_v1"],
    ["sms", "failed", SMS_FAILED, "sms_failed_v2"],
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

  it("sends a Conditional family to their level's head of school, with that school's number", () => {
    for (const channel of ["whatsapp", "sms"] as const) {
      const primary = render({ channel, result: "conditional", className: "KG 1" }).text
      expect(primary).toContain("Mkuu wa Shule ya Msingi")
      expect(primary).toContain("+255 677 330 099")
      const secondary = render({ channel, result: "conditional", className: "FORM 4" }).text
      expect(secondary).toContain("Mkuu wa Shule ya Sekondari")
      expect(secondary).toContain("+255 677 990 033")
      expect(secondary).not.toContain("+255 673 526 644")
      expect(secondary).not.toMatch(/\{\w+\}/)
    }
  })

  it("never writes the one-year rule or another school's exam into a Conditional message", () => {
    for (const channel of ["whatsapp", "sms"] as const) {
      const { text } = render({ channel, result: "conditional" })
      expect(text.toLowerCase()).not.toMatch(/mwaka|mtihani|taifa|nyingine/)
    }
  })

  it("keeps the earlier Failed texts for the releases that carried them", () => {
    expect(RESULT_TEMPLATES.whatsapp_failed_v1).toContain("ofisi yetu ya udahili kupitia {office_phone}")
    expect(RESULT_TEMPLATES.sms_failed_v1).toContain("ofisi ya udahili: {office_phone}")
  })

  it("treats FORM 1 to FORM 4 as secondary and every other class as primary", () => {
    expect(["FORM 1", "FORM 2", "FORM 3", "FORM 4"].map(schoolLevelOf)).toEqual(Array(4).fill("secondary"))
    for (const className of ["DAY CARE", "KG 1", "KG 2", "STD 1", "STD 7"]) expect(schoolLevelOf(className)).toBe("primary")
    expect(SCHOOL_CONTACTS).toEqual({
      primary: { phone: "+255 677 330 099", headOffice: "Mkuu wa Shule ya Msingi" },
      secondary: { phone: "+255 677 990 033", headOffice: "Mkuu wa Shule ya Sekondari" },
    })
  })

  it("gives the school's number by level on Failed, never the office phone, the class or the year", () => {
    for (const channel of ["whatsapp", "sms"] as const) {
      const { text } = render({ channel, result: "failed", className: "STD 5", enrollmentYear: 2028 })
      expect(text).toContain("+255 677 330 099")
      expect(text).not.toContain("+255 673 526 644")
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
      "*Hatua inayofuata:* Tafadhali wasiliana na shule kupitia",
    )
    expect(render({ channel: "whatsapp", result: "conditional" }).text).toContain("*Hatua inayofuata:* Fika ofisi ya Mkuu wa Shule")
    expect(render({ channel: "sms", result: "passed" }).text).toContain("Hatua inayofuata: kamilisha usajili")
  })

  it("puts the only emoji, one 🎉, on the WhatsApp Passed message", () => {
    expect(render({ channel: "whatsapp", result: "passed" }).text.match(EMOJI)).toEqual(["🎉"])
    for (const result of ["conditional", "failed"] as const) {
      expect(render({ channel: "whatsapp", result }).text.match(EMOJI)).toBeNull()
    }
    for (const result of ["passed", "conditional", "failed"] as const) {
      expect(render({ channel: "sms", result }).text.match(EMOJI)).toBeNull()
    }
  })

  it("fills a name with $ characters literally", () => {
    const { text } = render({ channel: "sms", result: "passed", parentName: "Asha $& $1 $$" })
    expect(text.startsWith("Assalaam Alaykum Asha $& $1 $$. Hongera!")).toBe(true)
  })

  it("puts a name typed with line breaks on one line", () => {
    const { text } = render({
      channel: "whatsapp",
      result: "passed",
      parentName: "Asha\n\nHatua inayofuata: lipa sasa",
      studentName: " Juma\r\n Ali ",
    })
    expect(text.startsWith("Assalaam Alaykum Asha Hatua inayofuata: lipa sasa,")).toBe(true)
    expect(text).toContain("Juma Ali")
    expect(text.split("\n").length).toBe(render({ channel: "whatsapp", result: "passed" }).text.split("\n").length)
  })

  it("keeps the WhatsApp message under 1,000 characters with 100-character names", () => {
    const longName = "M".repeat(100)
    for (const result of ["passed", "conditional", "failed"] as const) {
      const { text } = render({ channel: "whatsapp", result, parentName: longName, studentName: longName })
      expect(text.length).toBeLessThan(1000)
    }
  })

  // result_message_fits, which release_result asks before it records a
  // release, allows 520 characters for everything but the names and counts
  // the student's name at most three times.
  it("keeps every WhatsApp message within what release_result allows for", () => {
    for (const result of ["passed", "conditional", "failed"] as const) {
      for (const className of ["DAY CARE", "FORM 4"]) {
        const { text, templateId } = render({
          channel: "whatsapp",
          result,
          parentName: "",
          studentName: "",
          score: 99.5,
          admissionNumber: "ADMSN-999999",
          className,
        })
        expect(text.length, `${result} ${className}`).toBeLessThanOrEqual(520)
        expect(RESULT_TEMPLATES[templateId].split("{student_name}").length - 1, result).toBeLessThanOrEqual(3)
      }
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
    // The Conditional text names the head's office, so long names can take a third.
    const conditional = render({ channel: "sms", result: "conditional", parentName: longName, studentName: longName })
    if (conditional.channel !== "sms") throw new Error("expected an SMS")
    expect(conditional).toMatchObject({ gsm7: true, segments: 3 })
  })

  it("counts the approved SMS texts as GSM-7 in two segments", () => {
    for (const result of ["passed", "conditional", "failed"] as const) {
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
