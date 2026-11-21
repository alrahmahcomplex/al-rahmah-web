import { describe, expect, it } from "vitest"

import { completion, exactly, restOf, search, startsWith, takesCompletion } from "@/components/guided-form/type-ahead"
import { COUNTRIES, COUNTRY_NAMES, countryFlag, onList, OUTSIDE_TANZANIA, regionsOutsideFirst } from "@/lib/places"

// The type-ahead rules (#511, prototype v53) and the lists they read.

const REGIONS = ["Dar es Salaam", "Pwani", "Outside Tanzania", "Dodoma", "Kagera", "Katavi", "Kaskazini Unguja", "Arusha"]
const options = regionsOutsideFirst(REGIONS).map((r) => ({ value: r, label: r === OUTSIDE_TANZANIA ? "Outside Tanzania (Other Country)" : r }))

describe("the region list", () => {
  it("starts with Outside Tanzania, then A to Z", () => {
    expect(regionsOutsideFirst(REGIONS)).toEqual(["Outside Tanzania", "Arusha", "Dar es Salaam", "Dodoma", "Kagera", "Kaskazini Unguja", "Katavi", "Pwani"])
  })
})

describe("the faint completion", () => {
  it("is the first option the typed letters begin, in any capitals", () => {
    expect(completion(options, "ka")?.value).toBe("Kagera")
    expect(completion(options, "KAT")?.value).toBe("Katavi")
    expect(completion(options, "out")?.value).toBe("Outside Tanzania")
  })

  it("keeps a typed space and ignores spaces before the letters", () => {
    expect(completion(options, "dar ")?.value).toBe("Dar es Salaam")
    expect(completion(options, "  pw")?.value).toBe("Pwani")
  })

  it("is nothing for nothing typed, no match, or a whole name", () => {
    expect(completion(options, "")).toBeNull()
    expect(completion(options, "zz")).toBeNull()
    expect(completion(options, "pwani")).toBeNull()
  })

  it("draws the rest after what was typed, ignoring leading and repeated spaces", () => {
    expect(restOf("kag", "Kagera")).toBe("era")
    expect(restOf("KAG", "Kagera")).toBe("era")
    expect(restOf("  pw", "Pwani")).toBe("ani")
    expect(restOf("dar  es", "Dar es Salaam")).toBe(" Salaam")
    expect(restOf("   ", "Pwani")).toBe("")
    expect(restOf("kx", "Kagera")).toBe("")
    expect(restOf("", "Kagera")).toBe("")
  })
})

describe("the keys that take it", () => {
  it("takes Right arrow only at the end, Tab but not Shift+Tab, and Enter", () => {
    expect(takesCompletion("ArrowRight", { caretAtEnd: true })).toBe(true)
    expect(takesCompletion("ArrowRight", { caretAtEnd: false })).toBe(false)
    expect(takesCompletion("Tab", {})).toBe(true)
    expect(takesCompletion("Tab", { shift: true })).toBe(false)
    expect(takesCompletion("Enter", {})).toBe(true)
  })

  it("takes Space only when one option fits", () => {
    expect(takesCompletion(" ", { fits: 1 })).toBe(true)
    expect(takesCompletion(" ", { fits: 2 })).toBe(false)
    expect(startsWith(options, "ka").map((o) => o.value)).toEqual(["Kagera", "Kaskazini Unguja", "Katavi"])
    expect(startsWith(options, "pw")).toHaveLength(1)
  })

  it("takes no other key", () => {
    expect(takesCompletion("a", { fits: 1 })).toBe(false)
    expect(takesCompletion("ArrowDown", {})).toBe(false)
  })
})

describe("a whole option typed", () => {
  it("is found in any capitals and with spaces at either end", () => {
    expect(exactly(options, " dodoma ")?.value).toBe("Dodoma")
    expect(exactly(options, "outside tanzania (other country)")?.value).toBe("Outside Tanzania")
    expect(exactly(options, "dodo")).toBeNull()
    expect(exactly(options, "")).toBeNull()
  })
})

describe("the list's search", () => {
  it("finds the words anywhere in a label, and lists everything when empty", () => {
    expect(search(options, "unguja").map((o) => o.value)).toEqual(["Kaskazini Unguja"])
    expect(search(options, "  ")).toHaveLength(options.length)
    expect(search(options, "es sal").map((o) => o.value)).toEqual(["Dar es Salaam"])
  })
})

describe("the country list", () => {
  it("is A to Z by name, each country once, without Tanzania", () => {
    const sorted = [...COUNTRY_NAMES].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
    expect(COUNTRY_NAMES).toEqual(sorted)
    expect(new Set(COUNTRY_NAMES).size).toBe(COUNTRY_NAMES.length)
    expect(new Set(COUNTRIES.map(([code]) => code)).size).toBe(COUNTRIES.length)
    expect(COUNTRIES.some(([code, name]) => code === "TZ" || /tanzania/i.test(name))).toBe(false)
  })

  it("gives a listed country its flag, and any other name none", () => {
    expect(countryFlag("Kenya")).toBe("🇰🇪")
    expect(countryFlag("Atlantis")).toBe("")
  })

  it("finds a name in the list's spelling", () => {
    expect(onList(COUNTRY_NAMES, "  south   africa ")).toBe("South Africa")
    expect(onList(COUNTRY_NAMES, "Narnia")).toBeNull()
  })
})
