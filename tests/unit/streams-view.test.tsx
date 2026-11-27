import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  open: vi.fn(),
  change: vi.fn(),
  bringUp: vi.fn(),
  request: vi.fn(),
  remove: vi.fn(),
}))
vi.mock("@/app/staff/seats/stream-actions", () => ({
  openStreamAction: actions.open,
  changeStreamAction: actions.change,
  bringUpAction: actions.bringUp,
  requestStreamAction: actions.request,
  deleteStreamAction: actions.remove,
}))

import { StreamsView, type Who } from "@/app/staff/seats/streams-view"
import type { ClassStreams, PlacedChild, Stream, YearStreams } from "@/lib/services/streams"

// Seats once streams are on (#449, v42), with the actions stubbed: who sees
// which notice and button, and what the open sheet sends.

const MANAGER: Who = { manages: true, mayDecline: true }
const STAFF: Who = { manages: false, mayDecline: false }

const stream = (id: string, label: string, takes: Stream["takes"], seats: number, placed: number, position: number): Stream => ({
  id,
  label,
  takes,
  seats,
  position,
  placed,
  boys: 0,
  girls: 0,
  broughtUpFrom: null,
})

const FORM1: ClassStreams = {
  className: "FORM 1",
  streams: [stream("g", "A", "Girls", 20, 12, 1), stream("b", "B", "Boys", 20, 20, 2)],
  freeForBoy: false,
  freeForGirl: true,
  freeForAny: false,
  waiting: [
    {
      leadId: "lead-1",
      admissionNumber: "ADMSN-41207",
      studentName: "Juma Ali Mrisho",
      gender: "Boy",
      priority: "Deposit",
      reachedOn: "2027-01-08",
      rank: 1,
    },
  ],
}

const YEAR: YearStreams = {
  year: 2027,
  classes: [FORM1],
  requests: [],
}

// The 12 girls placed in FORM 1 A (Girls), ranked after the waiting boy.
const PLACED: PlacedChild[] = Array.from({ length: 12 }, (_, i) => ({
  leadId: `girl-${i + 1}`,
  studentName: `Girl ${i + 1}`,
  gender: "Girl",
  className: "FORM 1",
  streamId: "g",
  rank: i + 2,
}))

function view(who: Who, data: YearStreams = YEAR) {
  return render(<StreamsView data={data} previous={null} who={who} tabs={null} placed={who.manages ? PLACED : []} />)
}

beforeEach(() => vi.clearAllMocks())

describe("StreamsView", () => {
  it("shows the Manager the notice to open a stream for boys, the waiting child with Decline, and the pencils", () => {
    view(MANAGER)
    expect(screen.getByText("Open a new FORM 1 stream for boys.")).toBeInTheDocument()
    expect(screen.getByText(/FORM 1 B \(Boys\) is full\./)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open a new FORM 1 stream" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Waiting for a stream" })).toBeInTheDocument()
    expect(
      screen.getByRole("link", {
        name: "Decline Juma Ali Mrisho: No seat available",
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Change FORM 1 B (Boys)" })).toBeInTheDocument()
    expect(screen.getByText("32 of 40 seats taken · 2 streams")).toBeInTheDocument()
  })

  it("gives other staff the request button, no Decline and no pencils", async () => {
    actions.request.mockResolvedValue({
      status: "done",
      message: "Request sent to the Admissions Manager.",
    })
    view(STAFF)
    expect(screen.getByText("FORM 1 has no seat left for boys.")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Decline/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Change FORM 1/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add a stream" })).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole("button", {
        name: "Send a request to open a new stream",
      }),
    )
    expect(actions.request).toHaveBeenCalledWith({
      year: 2027,
      className: "FORM 1",
      need: "Boys",
    })
    expect(await screen.findByRole("button", { name: "Request sent" })).toBeDisabled()
  })

  it("tells other staff a request is already open", () => {
    const request = {
      id: "r1",
      className: "FORM 1" as const,
      need: "Boys" as const,
      leadId: null,
      studentName: null,
      requestedByName: "Asha",
      requestedByRole: "Admissions Staff",
      requestedAt: "2027-01-11T06:40:00Z",
      resolvedAt: null,
      resolvedByStreamId: null,
    }
    view(STAFF, { ...YEAR, requests: [request] })
    expect(screen.getByText("Request sent at 09:40.")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", {
        name: "Send a request to open a new stream",
      }),
    ).not.toBeInTheDocument()
  })

  it("reads a class without streams as no limit", () => {
    view(STAFF)
    expect(screen.getAllByText("Seats not set · no limit")).toHaveLength(13)
    expect(screen.getByText("Any child can take a seat in DAY CARE: it has no streams, so nothing is ever blocked here.")).toBeInTheDocument()
  })

  it("opens a Boys stream with the suggested label (A: a Girls A does not clash) and the seats typed", async () => {
    actions.open.mockResolvedValue({
      status: "done",
      message: "FORM 1 A (Boys) is open with 20 seats.",
    })
    view(MANAGER)
    await userEvent.click(screen.getByRole("button", { name: "Open a new FORM 1 stream" }))
    const sheet = await screen.findByRole("dialog", {
      name: "Open a new FORM 1 stream",
    })
    expect(within(sheet).getByLabelText("Label")).toHaveValue("A")
    expect(within(sheet).getByLabelText("Seats")).toHaveAttribute("placeholder", "20")
    await userEvent.type(within(sheet).getByLabelText("Seats"), "20")
    await userEvent.click(screen.getByRole("button", { name: "Open the stream" }))
    await waitFor(() => expect(actions.open).toHaveBeenCalledTimes(1))
    expect(actions.open.mock.calls[0][0]).toMatchObject({
      year: 2027,
      className: "FORM 1",
      label: "A",
      takes: "Boys",
      seats: 20,
      name: "FORM 1 A (Boys)",
    })
  })

  it("refuses seats below the children placed before saving", async () => {
    view(MANAGER)
    await userEvent.click(screen.getByRole("button", { name: "Change FORM 1 A (Girls)" }))
    const sheet = await screen.findByRole("dialog", {
      name: "Change FORM 1 A (Girls)",
    })
    const seats = within(sheet).getByLabelText("Seats")
    await userEvent.clear(seats)
    await userEvent.type(seats, "10")
    await userEvent.click(screen.getByRole("button", { name: "Save the changes" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("12 children stay in FORM 1 A, so the seats can’t go below 12.")
    expect(actions.change).not.toHaveBeenCalled()
  })

  // Who a stream takes (owner 2026-11-26, prototype v4).
  it("hides the pencils, not the page, when the children placed couldn’t be read", () => {
    render(<StreamsView data={YEAR} previous={null} who={MANAGER} tabs={null} placed={null} />)
    expect(screen.getByRole("list", { name: "FORM 1 streams" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Change FORM 1/ })).not.toBeInTheDocument()
  })

  async function changeToBoys() {
    view(MANAGER)
    await userEvent.click(screen.getByRole("button", { name: "Change FORM 1 A (Girls)" }))
    const sheet = await screen.findByRole("dialog", { name: "Change FORM 1 A (Girls)" })
    await userEvent.click(within(sheet).getByRole("radio", { name: "Boys" }))
    return sheet
  }

  it("says the girls must move, that no stream takes them, and asks where they go before saving", async () => {
    const sheet = await changeToBoys()
    expect(within(sheet).getByRole("heading", { name: "12 girls have to move" })).toBeInTheDocument()
    expect(sheet).toHaveTextContent("No other FORM 1 stream takes girls. Choose where they go before saving.")
    // The waiting boy takes one of the places the girls leave.
    expect(sheet).toHaveTextContent("1 boy waiting for a FORM 1 seat takes a place in FORM 1 A in the places the girls leave.")
    await userEvent.click(screen.getByRole("button", { name: "Save: 12 girls will wait" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose where the 12 girls go.")
    expect(actions.change).not.toHaveBeenCalled()
  })

  it("saves with the girls left waiting when the Manager lets them wait", async () => {
    actions.change.mockResolvedValue({
      status: "done",
      stream: { label: "A", takes: "Boys", seats: 20 },
      opened: null,
      moved: PLACED.map((child) => ({ leadId: child.leadId, streamId: null })),
      seatedFromWaiting: 1,
    })
    const sheet = await changeToBoys()
    await userEvent.click(within(sheet).getByRole("radio", { name: /Let them wait/ }))
    expect(sheet).toHaveTextContent("12 girls will have no seat.")
    await userEvent.click(screen.getByRole("button", { name: "Save: 12 girls will wait" }))
    await waitFor(() => expect(actions.change).toHaveBeenCalledTimes(1))
    expect(actions.change.mock.calls[0][0]).toMatchObject({ streamId: "g", label: "A", seats: 20, takes: "Boys", open: undefined, raise: undefined })
  })

  it("opens a girls stream in the same save, says how many seats keep everyone placed, and warns when fewer will wait", async () => {
    actions.change.mockResolvedValue({ status: "done", stream: { label: "A", takes: "Boys", seats: 20 }, opened: null, moved: [], seatedFromWaiting: 0 })
    const sheet = await changeToBoys()
    await userEvent.click(within(sheet).getByRole("radio", { name: /Open a new stream for girls/ }))
    // No other stream takes girls, so the new one may go without a label (owner 2026-11-26).
    expect(within(sheet).getAllByLabelText("Label")[1]).toHaveValue("")
    expect(sheet).toHaveTextContent("No label: shown as “FORM 1 (Girls)”")
    expect(sheet).toHaveTextContent("12 or more so nobody waits: the 12 girls moving.")
    await userEvent.type(within(sheet).getAllByLabelText("Seats")[1], "10")
    expect(sheet).toHaveTextContent("2 girls will have no seat.")
    await userEvent.click(screen.getByRole("button", { name: "Save: 10 move, 2 wait" }))
    await waitFor(() => expect(actions.change).toHaveBeenCalledTimes(1))
    expect(actions.change.mock.calls[0][0]).toMatchObject({ takes: "Boys", open: { takes: "Girls", label: "", seats: 10 }, raise: undefined })
  })
})

describe("StreamsView, an optional label and deleting an empty stream (owner 2026-11-26)", () => {
  const STD1: ClassStreams = {
    className: "STD 1",
    streams: [stream("one", "", "Mixed", 40, 30, 1), stream("two", "B", "Mixed", 40, 0, 2)],
    freeForBoy: true,
    freeForGirl: true,
    freeForAny: true,
    waiting: [],
  }
  const data: YearStreams = { year: 2027, classes: [STD1], requests: [] }

  it("shows a stream with no label as its class alone, and a stream added next to it needs a label: A is skipped", async () => {
    view(MANAGER, data)
    const card = screen.getByRole("button", { name: "Change STD 1" }).closest("section") as HTMLElement
    await userEvent.click(within(card).getByRole("button", { name: "Add a stream" }))
    const sheet = await screen.findByRole("dialog", { name: "Open a new STD 1 stream" })
    expect(within(sheet).getByLabelText("Label")).toHaveValue("C")
    await userEvent.clear(within(sheet).getByLabelText("Label"))
    expect(sheet).toHaveTextContent("STD 1 already has no label, so this stream needs one, for example C.")
    await userEvent.type(within(sheet).getByLabelText("Seats"), "40")
    await userEvent.click(screen.getByRole("button", { name: "Open the stream" }))
    expect(actions.open).not.toHaveBeenCalled()
  })

  it("a stream with children can't be deleted, and says why", async () => {
    view(MANAGER, data)
    await userEvent.click(screen.getByRole("button", { name: "Change STD 1" }))
    const sheet = await screen.findByRole("dialog", { name: "Change STD 1" })
    expect(within(sheet).queryByRole("button", { name: "Delete this stream" })).toBeNull()
    expect(sheet).toHaveTextContent("Only an empty stream can be deleted. 30 children are placed in STD 1.")
  })

  it("an empty stream is deleted after a second yes", async () => {
    actions.remove.mockResolvedValue({ status: "done", message: "STD 1 B is deleted." })
    view(MANAGER, data)
    await userEvent.click(screen.getByRole("button", { name: "Change STD 1 B" }))
    const sheet = await screen.findByRole("dialog", { name: "Change STD 1 B" })
    await userEvent.click(within(sheet).getByRole("button", { name: "Delete this stream" }))
    const confirm = await screen.findByRole("dialog", { name: "Delete STD 1 B?" })
    expect(confirm).toHaveTextContent("STD 1 B goes for good")
    await userEvent.click(within(confirm).getByRole("button", { name: "Keep it" }))
    await screen.findByRole("dialog", { name: "Change STD 1 B" })
    expect(actions.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "Delete this stream" }))
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete STD 1 B" }))
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith({ streamId: "two", name: "STD 1 B" }))
  })
})

describe("StreamsView, a Mixed-only class", () => {
  const STD6: ClassStreams = {
    className: "STD 6",
    streams: [stream("m", "A", "Mixed", 1, 1, 1)],
    freeForBoy: false,
    freeForGirl: false,
    freeForAny: false,
    waiting: [],
  }
  const fromChild = {
    id: "r2",
    className: "STD 6" as const,
    need: "Girls" as const,
    leadId: "lead-2",
    studentName: "Rehema Saidi Bakari",
    requestedByName: "Asha",
    requestedByRole: "Admissions Staff",
    requestedAt: "2027-01-11T06:40:00Z",
    resolvedAt: null,
    resolvedByStreamId: null,
  }

  it("names the child a request came from, for the Manager", () => {
    view(MANAGER, { ...YEAR, classes: [STD6], requests: [fromChild] })
    expect(
      screen.getByText(/Asha \(Admissions Staff\) asked at 09:40: Rehema Saidi Bakari can’t pay her school fee until a stream takes her\./),
    ).toBeInTheDocument()
  })

  it("shows other staff the request as sent", () => {
    view(STAFF, { ...YEAR, classes: [STD6], requests: [fromChild] })
    expect(screen.getByText("Request sent at 09:40.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send a request to open a new stream" })).not.toBeInTheDocument()
  })
})

describe("children with no Boy or girl answer in a class without a Mixed stream", () => {
  const noAnswer = { ...FORM1.waiting[0], leadId: "lead-3", studentName: "Neema Hamisi", gender: null }
  // Seats free for boys and girls, and so for "any" child, as the database reports it; only a Mixed stream takes these two.
  const split: ClassStreams = {
    ...FORM1,
    streams: [stream("g", "A", "Girls", 20, 12, 1), stream("b", "B", "Boys", 20, 15, 2)],
    freeForBoy: true,
    freeForGirl: true,
    freeForAny: true,
    waiting: [
      { ...noAnswer, leadId: "lead-4", rank: 2 },
      { ...noAnswer, rank: 1 },
    ],
  }

  it("asks the Manager to open a stream for any child, naming no full stream", () => {
    view(MANAGER, { ...YEAR, classes: [split] })
    const notice = screen.getByText("Open a new FORM 1 stream.").closest(".st-notice") as HTMLElement
    expect(notice).toHaveTextContent("Open a new FORM 1 stream. 2 children wait for a seat.")
    expect(notice).not.toHaveTextContent("is full")
  })

  it("gives other staff the request for any child", () => {
    view(STAFF, { ...YEAR, classes: [split] })
    const notice = screen.getByText("FORM 1 has no seat left.").closest(".st-notice") as HTMLElement
    expect(notice).toHaveTextContent("FORM 1 has no seat left. Only the Admissions Manager can open a new stream.")
  })

  it("sends other staff's request for the first of these children, not for the class", async () => {
    actions.request.mockResolvedValue({ status: "done", message: "Request sent to the Admissions Manager." })
    view(STAFF, { ...YEAR, classes: [split] })
    await userEvent.click(screen.getByRole("button", { name: "Send a request to open a new stream" }))
    expect(actions.request).toHaveBeenCalledTimes(1)
    expect(actions.request).toHaveBeenCalledWith({ leadId: "lead-3" })
  })
})
