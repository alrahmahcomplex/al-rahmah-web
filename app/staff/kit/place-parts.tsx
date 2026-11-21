"use client"

import { useId, useState } from "react"

import { CapitalsBox, ChoiceTiles, cleanName, Hint, Icon, LastNameChoice, StudentNameBoxes, TypeAheadField, type StudentName } from "@/components/guided-form"
import { Card } from "@/components/kit"
import { studentFullName, type LastNameFrom } from "@/lib/names"
import { COUNTRY_NAMES, countryFlag, OUTSIDE_TANZANIA, regionsOutsideFirst } from "@/lib/places"

import { REGIONS } from "./fixtures"

// The parts Register students and Check-in use from prototype v50 to v55
// (#511), with the prototype's own words. Nothing is saved.

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name" }
const LAST_NAME = { group: "Student’s last name", last: "Father’s last name", middle: "Father’s middle name" }
const OUTSIDE = "Outside Tanzania (Other Country)"
const REGION_OPTIONS = regionsOutsideFirst(REGIONS).map((r) => ({ value: r, label: r === OUTSIDE_TANZANIA ? OUTSIDE : r }))
const COUNTRY_OPTIONS = COUNTRY_NAMES.map((c) => ({ value: c, label: c }))
const flag = (country: string) => <span className="gf-flag">{countryFlag(country)}</span>

const listLabels = (one: string, many: string) => ({
  field: one[0].toUpperCase() + one.slice(1),
  placeholder: `Type or choose a ${one}`,
  showAll: `Show all ${many}`,
  search: `Search ${many}`,
  list: many[0].toUpperCase() + many.slice(1),
  none: (q: string) => `No ${one} matches “${q}”.`,
})

export function LastNameCard() {
  const id = useId()
  const [name, setName] = useState<StudentName>({ firstName: "NEEMA", fatherFirst: "JUMA", fatherMiddle: "SALIM", fatherLast: "MRISHO" })
  const [from, setFrom] = useState<LastNameFrom>("father_last")
  const full = studentFullName({ ...name, fatherMiddle: cleanName(name.fatherMiddle), fatherLast: cleanName(name.fatherLast) }, from)
  return (
    <Card title="Last-name choice">
      <p className="kp-spec">Some students use the father’s middle name as their last name. Once his middle and last names are in, the form asks which one; his last name is picked to start with.</p>
      <div className="flex flex-col gap-3">
        <StudentNameBoxes id={id} labels={{ ...NAME_LABELS, student: "Student’s name", father: "Father’s name" }} value={name} onChange={setName} required={false} />
        <LastNameChoice name={`${id}-ln`} father={name} value={from} onChange={setFrom} labels={LAST_NAME} />
        <Hint className="text-center" aria-live="polite">
          {full.trim() && (
            <>
              Student’s full name: <b>{full}</b>
            </>
          )}
        </Hint>
      </div>
    </Card>
  )
}

export function PlaceListsCard() {
  const [school, setSchool] = useState("")
  const [region, setRegion] = useState("")
  const [country, setCountry] = useState("")
  const out = region === OUTSIDE_TANZANIA
  return (
    <Card title="Type-ahead list: region and country">
      <p className="kp-spec">
        Typing shows the best match as faint text; Right arrow, Tab or Enter takes it, and Space does when only one fits. The arrow opens the list over the page with a search box.
        Only these two lists go A to Z.
      </p>
      <div className="flex flex-col gap-3">
        <CapitalsBox value={school} onValueChange={setSchool} placeholder="School name" aria-label="School name" />
        <TypeAheadField
          options={REGION_OPTIONS}
          pinned={OUTSIDE_TANZANIA}
          value={region}
          onValueChange={(v) => {
            setRegion(v)
            if (v !== OUTSIDE_TANZANIA) setCountry("")
          }}
          lead={() => <Icon name="pin" small />}
          labels={listLabels("region", "regions")}
        />
        {out && (
          <TypeAheadField
            options={COUNTRY_OPTIONS}
            value={country}
            onValueChange={setCountry}
            lead={(v) => (v ? flag(v) : <Icon name="globe" small />)}
            optionLead={flag}
            labels={listLabels("country", "countries")}
          />
        )}
        <p className="kp-spec" aria-live="polite">
          {region ? `Saved: ${[school.trim(), region, out ? country || "a country is needed" : ""].filter(Boolean).join(" · ")}` : "Nothing picked yet."}
        </p>
      </div>
    </Card>
  )
}

export function TwoChoicesCard() {
  const id = useId()
  const [who, setWho] = useState<string | null>(null)
  return (
    <Card title="Two big choices">
      <p className="kp-spec">One question first, as two big buttons, each with a line under it. Nothing else shows until one is picked.</p>
      <ChoiceTiles
        name={`${id}-who`}
        layout="pair"
        legend={<span className="sr-only">Who is the custodian</span>}
        value={who}
        onChange={setWho}
        options={[
          { value: "father", label: "The father", description: "JUMA SALIM MRISHO" },
          { value: "else", label: "Someone else", description: "Mother, guardian or another person" },
        ]}
      />
    </Card>
  )
}
