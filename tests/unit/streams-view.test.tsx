import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({
  open: vi.fn(),
  edit: vi.fn(),
  bringUp: vi.fn(),
  request: vi.fn(),
}))
vi.mock("@/app/staff/seats/stream-actions", () => ({
  openStreamAction: actions.open,
  editStreamAction: actions.edit,
  bringUpAction: actions.bringUp,
  requestStreamAction: actions.request,
}))

import { StreamsView, type Who } from "@/app/staff/seats/streams-view"
import type { ClassStreams, Stream, YearStreams } from "@/lib/services/streams"

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
  mode: "named",
  year: 2027,
  classes: [FORM1],
  requests: [],
}

function view(who: Who, data: YearStreams = YEAR) {
  return render(<StreamsView data={data} previous={null} who={who} tabs={null} />)
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
    expect(within(sheet).getByLabelText("Seats for new students")).toHaveAttribute("placeholder", "20")
    await userEvent.type(within(sheet).getByLabelText("Seats for new students"), "20")
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
    const seats = within(sheet).getByLabelText("Seats for new students")
    await userEvent.clear(seats)
    await userEvent.type(seats, "10")
    await userEvent.click(screen.getByRole("button", { name: "Save the changes" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("FORM 1 A (Girls) has 12 children placed. The seats can’t go below 12.")
    expect(actions.edit).not.toHaveBeenCalled()
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
