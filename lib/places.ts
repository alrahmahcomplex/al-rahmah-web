// Where a student's previous school is (#511, prototype v53). The region
// list is previous_school_regions() in the database; a school Outside
// Tanzania also names its country, from previous_school_countries(). Both
// lists are the database's spelling: a test compares them.

/** previous_school_regions(): Tanzania's 31 regions, then "Outside Tanzania". */
export const OUTSIDE_TANZANIA = "Outside Tanzania"

/**
 * The countries a school Outside Tanzania can be in, A to Z by English name:
 * each with its ISO 3166 code, for the flag. Tanzania is not on it.
 */
export const COUNTRIES: readonly (readonly [code: string, name: string])[] = [
  ["AF", "Afghanistan"],
  ["AL", "Albania"],
  ["DZ", "Algeria"],
  ["AD", "Andorra"],
  ["AO", "Angola"],
  ["AG", "Antigua & Barbuda"],
  ["AR", "Argentina"],
  ["AM", "Armenia"],
  ["AU", "Australia"],
  ["AT", "Austria"],
  ["AZ", "Azerbaijan"],
  ["BS", "Bahamas"],
  ["BH", "Bahrain"],
  ["BD", "Bangladesh"],
  ["BB", "Barbados"],
  ["BY", "Belarus"],
  ["BE", "Belgium"],
  ["BZ", "Belize"],
  ["BJ", "Benin"],
  ["BT", "Bhutan"],
  ["BO", "Bolivia"],
  ["BA", "Bosnia & Herzegovina"],
  ["BW", "Botswana"],
  ["BR", "Brazil"],
  ["BN", "Brunei"],
  ["BG", "Bulgaria"],
  ["BF", "Burkina Faso"],
  ["BI", "Burundi"],
  ["KH", "Cambodia"],
  ["CM", "Cameroon"],
  ["CA", "Canada"],
  ["CV", "Cape Verde"],
  ["CF", "Central African Republic"],
  ["TD", "Chad"],
  ["CL", "Chile"],
  ["CN", "China"],
  ["CO", "Colombia"],
  ["KM", "Comoros"],
  ["CG", "Congo"],
  ["CR", "Costa Rica"],
  ["CI", "Côte d’Ivoire"],
  ["HR", "Croatia"],
  ["CU", "Cuba"],
  ["CY", "Cyprus"],
  ["CZ", "Czechia"],
  ["DK", "Denmark"],
  ["DJ", "Djibouti"],
  ["DM", "Dominica"],
  ["DO", "Dominican Republic"],
  ["CD", "DR Congo"],
  ["EC", "Ecuador"],
  ["EG", "Egypt"],
  ["SV", "El Salvador"],
  ["GQ", "Equatorial Guinea"],
  ["ER", "Eritrea"],
  ["EE", "Estonia"],
  ["SZ", "Eswatini"],
  ["ET", "Ethiopia"],
  ["FJ", "Fiji"],
  ["FI", "Finland"],
  ["FR", "France"],
  ["GA", "Gabon"],
  ["GM", "Gambia"],
  ["GE", "Georgia"],
  ["DE", "Germany"],
  ["GH", "Ghana"],
  ["GR", "Greece"],
  ["GD", "Grenada"],
  ["GT", "Guatemala"],
  ["GN", "Guinea"],
  ["GW", "Guinea-Bissau"],
  ["GY", "Guyana"],
  ["HT", "Haiti"],
  ["HN", "Honduras"],
  ["HU", "Hungary"],
  ["IS", "Iceland"],
  ["IN", "India"],
  ["ID", "Indonesia"],
  ["IR", "Iran"],
  ["IQ", "Iraq"],
  ["IE", "Ireland"],
  ["IL", "Israel"],
  ["IT", "Italy"],
  ["JM", "Jamaica"],
  ["JP", "Japan"],
  ["JO", "Jordan"],
  ["KZ", "Kazakhstan"],
  ["KE", "Kenya"],
  ["KI", "Kiribati"],
  ["XK", "Kosovo"],
  ["KW", "Kuwait"],
  ["KG", "Kyrgyzstan"],
  ["LA", "Laos"],
  ["LV", "Latvia"],
  ["LB", "Lebanon"],
  ["LS", "Lesotho"],
  ["LR", "Liberia"],
  ["LY", "Libya"],
  ["LI", "Liechtenstein"],
  ["LT", "Lithuania"],
  ["LU", "Luxembourg"],
  ["MG", "Madagascar"],
  ["MW", "Malawi"],
  ["MY", "Malaysia"],
  ["MV", "Maldives"],
  ["ML", "Mali"],
  ["MT", "Malta"],
  ["MH", "Marshall Islands"],
  ["MR", "Mauritania"],
  ["MU", "Mauritius"],
  ["MX", "Mexico"],
  ["FM", "Micronesia"],
  ["MD", "Moldova"],
  ["MC", "Monaco"],
  ["MN", "Mongolia"],
  ["ME", "Montenegro"],
  ["MA", "Morocco"],
  ["MZ", "Mozambique"],
  ["MM", "Myanmar"],
  ["NA", "Namibia"],
  ["NR", "Nauru"],
  ["NP", "Nepal"],
  ["NL", "Netherlands"],
  ["NZ", "New Zealand"],
  ["NI", "Nicaragua"],
  ["NE", "Niger"],
  ["NG", "Nigeria"],
  ["KP", "North Korea"],
  ["MK", "North Macedonia"],
  ["NO", "Norway"],
  ["OM", "Oman"],
  ["PK", "Pakistan"],
  ["PW", "Palau"],
  ["PS", "Palestine"],
  ["PA", "Panama"],
  ["PG", "Papua New Guinea"],
  ["PY", "Paraguay"],
  ["PE", "Peru"],
  ["PH", "Philippines"],
  ["PL", "Poland"],
  ["PT", "Portugal"],
  ["QA", "Qatar"],
  ["RO", "Romania"],
  ["RU", "Russia"],
  ["RW", "Rwanda"],
  ["WS", "Samoa"],
  ["SM", "San Marino"],
  ["ST", "São Tomé & Príncipe"],
  ["SA", "Saudi Arabia"],
  ["SN", "Senegal"],
  ["RS", "Serbia"],
  ["SC", "Seychelles"],
  ["SL", "Sierra Leone"],
  ["SG", "Singapore"],
  ["SK", "Slovakia"],
  ["SI", "Slovenia"],
  ["SB", "Solomon Islands"],
  ["SO", "Somalia"],
  ["ZA", "South Africa"],
  ["KR", "South Korea"],
  ["SS", "South Sudan"],
  ["ES", "Spain"],
  ["LK", "Sri Lanka"],
  ["KN", "St. Kitts & Nevis"],
  ["LC", "St. Lucia"],
  ["VC", "St. Vincent & Grenadines"],
  ["SD", "Sudan"],
  ["SR", "Suriname"],
  ["SE", "Sweden"],
  ["CH", "Switzerland"],
  ["SY", "Syria"],
  ["TW", "Taiwan"],
  ["TJ", "Tajikistan"],
  ["TH", "Thailand"],
  ["TL", "Timor-Leste"],
  ["TG", "Togo"],
  ["TO", "Tonga"],
  ["TT", "Trinidad & Tobago"],
  ["TN", "Tunisia"],
  ["TR", "Türkiye"],
  ["TM", "Turkmenistan"],
  ["TV", "Tuvalu"],
  ["UG", "Uganda"],
  ["UA", "Ukraine"],
  ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
  ["UY", "Uruguay"],
  ["UZ", "Uzbekistan"],
  ["VU", "Vanuatu"],
  ["VA", "Vatican City"],
  ["VE", "Venezuela"],
  ["VN", "Vietnam"],
  ["YE", "Yemen"],
  ["ZM", "Zambia"],
  ["ZW", "Zimbabwe"],
]

export const COUNTRY_NAMES: readonly string[] = COUNTRIES.map(([, name]) => name)

const CODES = new Map(COUNTRIES.map(([code, name]) => [name, code]))

/** The flag of a country on the list, as its two regional-indicator letters; empty for any other name. */
export function countryFlag(name: string): string {
  const code = CODES.get(name)
  return code ? String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : ""
}

/** A name on a list, in the list's spelling, ignoring case and spaces at either end; null when it is not on it. */
export function onList(list: readonly string[], typed: string): string | null {
  const want = typed.trim().replace(/\s+/g, " ").toLowerCase()
  return want === "" ? null : (list.find((x) => x.toLowerCase() === want) ?? null)
}

const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" })

/** The region list as the type-ahead field shows it (#511): Outside Tanzania first, then A to Z. Other region dropdowns keep their own order. */
export function regionsOutsideFirst(regions: readonly string[]): string[] {
  return [...regions.filter((r) => r === OUTSIDE_TANZANIA), ...regions.filter((r) => r !== OUTSIDE_TANZANIA).sort(byName)]
}

/** The country list with the school's saved country first, so confirming it again is one tap (#511). */
export function countriesSavedFirst(saved: string | null | undefined): string[] {
  return saved && COUNTRY_NAMES.includes(saved) ? [saved, ...COUNTRY_NAMES.filter((c) => c !== saved)] : [...COUNTRY_NAMES]
}

/** The same previous school's name, whatever its capitals and spacing (#511). */
export function sameSchoolName(a: string | null | undefined, b: string | null | undefined): boolean {
  const clean = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase()
  return clean(a) === clean(b)
}

/**
 * Where a previous school's country stands in an editor (#511, lead's rule). `missing`: a school entered, or with
 * its name or region changed, Outside Tanzania needs a country picked. `again`: the saved country still shows for
 * another school or a new region, and counts once staff pick it again. Private or public alone, or a school saved
 * before the country list left as it is, needs nothing.
 */
export function countryNeed(input: {
  saved: { name: string; region: string; country?: string | null } | null | undefined
  name: string
  region: string
  country: string
  picked: boolean
  touched: boolean
}): "ok" | "missing" | "again" {
  const { saved, name, region, country, picked, touched } = input
  if (region !== OUTSIDE_TANZANIA) return "ok"
  const changed = !saved || !sameSchoolName(name, saved.name) || region !== saved.region
  if (!country) return changed || touched ? "missing" : "ok"
  if (changed && saved?.country && country === saved.country && !picked) return "again"
  return "ok"
}
