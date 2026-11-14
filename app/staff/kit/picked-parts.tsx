"use client"

import { useId, useState, type FormEvent } from "react"

import { CodeBox, FieldError, FullNameBox, hasTwoNames, PersonNameBoxes, StudentNameBoxes } from "@/components/guided-form"
import { Accordion, AvatarGroup, Avatar, Button, Card, Pagination, RoundButton, StepSlider, TabSwitch, Tooltip, type AvatarTone } from "@/components/kit"

// The parts the owner picked on prototype v38's Design system page (#402),
// with the prototype's own example words. Nothing is saved.

const NAME_LABELS = { first: "First name", middle: "Middle name", last: "Last name" }
const RECORD_TABS = ["Overview", "Interview", "School fee", "Follow-ups"]
const PEOPLE = [
  ["RM", "Rehema M."],
  ["AS", "Asha Saidi"],
  ["JK", "Juma Khamis"],
  ["LO", "Latifa Omari"],
  ["BS", "Bakari Said"],
  ["MK", "Mwajuma Kombo"],
  ["HA", "Hassan Ali"],
] as const
const SIZES = [24, 32, 40, 56] as const
const TONES: AvatarTone[] = ["indigo", "orange", "green", "indigo"]
const QUESTIONS = [
  ["Who sees the family’s Discount code?", "The person who gave the code sees each student’s admission progress. Nobody else does."],
  ["When does the sibling discount start?", "As soon as the fathers’ names match. When they don’t, the Admissions Manager decides after seeing proof."],
  ["Can a fee be changed by hand?", "Yes, by staff who may record payments. Every change keeps its reason in the audit log."],
] as const
const TIPS = [
  ["filter", "Filter Visited applicants"],
  ["bell", "New requests"],
  ["panel", "Fold the sidebar"],
] as const

export function PickedPartsCards() {
  const [page, setPage] = useState(3)
  const [discount, setDiscount] = useState(10)
  return (
    <>
      <Card title="Tabs: sliding track" className="kp-full">
        <p className="kp-spec">Sections of one record. One indigo pill slides to the chosen tab; the arrow keys move along.</p>
        <TabSwitch label="Record sections" tabs={RECORD_TABS.map((t) => ({ value: t, label: t, panel: <p className="kp-spec">Showing: {t}</p> }))} />
      </Card>

      <Card title="Pagination: numbered pills" className="kp-full">
        <p className="kp-spec">For lists longer than 10 rows, such as Applicants and Audit.</p>
        <Pagination label="Applicant pages" page={page} pageCount={12} onPage={setPage} previousLabel="Previous page" nextLabel="Next page" pageLabel={(n) => `Page ${n}`} />
        <p className="kp-spec" aria-live="polite">
          Page {page} of 12
        </p>
      </Card>

      <Card title="Avatars: soft tints">
        <div className="kp-rowx" style={{ alignItems: "flex-end" }}>
          {SIZES.map((size, i) => (
            <Avatar key={size} initials={PEOPLE[i][0]} name={PEOPLE[i][1]} size={size} tone={TONES[i]} />
          ))}
        </div>
        <AvatarGroup people={PEOPLE.map(([initials]) => ({ initials }))} label="Rehema M., Asha Saidi, Juma Khamis, Latifa Omari and 3 others" />
        <p className="kp-spec">Initials stand in for photos. Sizes 24, 32, 40 and 56; a group stacks with a count.</p>
      </Card>

      <Card title="Tooltips: light">
        <div className="kp-rowx" style={{ justifyContent: "center", paddingTop: 34 }}>
          {TIPS.map(([icon, label]) => (
            <Tooltip key={icon} label={label}>
              <RoundButton icon={icon} label={label} />
            </Tooltip>
          ))}
        </div>
        <p className="kp-spec">A short name for an icon button, shown on hover and on keyboard focus. Escape hides it.</p>
      </Card>

      <Card title="Slider: steps with labels">
        <StepSlider min={0} max={25} step={5} value={discount} onValueChange={setDiscount} unit="%" aria-label="Discount, percent" />
        <p className="kp-spec">
          Discount on the school fee: <b>{discount}%</b>
        </p>
      </Card>

      <Card title="Accordion: separate cards">
        <Accordion items={QUESTIONS.map(([title, answer]) => ({ title, content: <p>{answer}</p> }))} />
      </Card>

      <NamesCard />
    </>
  )
}

function NamesCard() {
  const ids = { person: useId(), student: useId(), who: useId(), whoError: useId(), code: useId() }
  const [whoError, setWhoError] = useState("")
  const check = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const who = new FormData(event.currentTarget).get("brought_by_name")
    setWhoError(hasTwoNames(String(who ?? "")) ? "" : "Type their full name, at least two names.")
  }
  return (
    <Card title="Names and codes" className="kp-full">
      <p className="kp-spec">Names are typed in capitals. Space moves to the next box, a pasted full name spreads across the boxes, and Backspace in an empty box goes back.</p>
      <form className="kp-fpg" data-kit-form="names" noValidate onSubmit={check}>
        <div className="kp-fpc">
          <h3 id={ids.person}>Agent or custodian</h3>
          <PersonNameBoxes id={ids.person + "-n"} aria-labelledby={ids.person} labels={NAME_LABELS} required={false} />
        </div>
        <div className="kp-fpc">
          <h3 id={ids.student}>Student</h3>
          <StudentNameBoxes id={ids.student + "-n"} aria-labelledby={ids.student} labels={{ ...NAME_LABELS, student: "Student’s name", father: "Father’s name" }} required={false} />
        </div>
        <div className="kp-fpc">
          <h3>Who brought the students</h3>
          <FullNameBox
            id={ids.who}
            name="brought_by_name"
            placeholder="Their full name"
            aria-label="Their full name"
            invalid={!!whoError}
            aria-describedby={ids.whoError}
            onValueChange={() => setWhoError("")}
          />
          <FieldError id={ids.whoError} message={whoError} />
          <Button variant="ghost" size="small" type="submit" style={{ alignSelf: "flex-start" }}>
            Check the name
          </Button>
        </div>
        <div className="kp-fpc">
          <h3>Discount code</h3>
          <CodeBox id={ids.code} name="code" placeholder="Discount code, e.g. ABC-123" aria-label="Discount code" />
          <p className="kp-spec">Capitals and the hyphen by themselves: AAN132 becomes AAN-132.</p>
        </div>
      </form>
    </Card>
  )
}
