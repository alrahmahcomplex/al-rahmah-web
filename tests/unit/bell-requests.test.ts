import { describe, expect, it } from "vitest"

import { bellRequests } from "@/app/staff/_new-shell/bell-requests"

describe("bellRequests", () => {
  it("lists discount and reopening requests newest first, each linking to its screen", () => {
    const list = bellRequests(
      [{ id: "d1", studentName: "Rehema Ali", kind: "staff_child", note: "Mother teaches FORM 2", requestedAt: "2026-11-02T09:00:00Z" }],
      [{ id: "r1", studentName: "Juma Khamis Ali", reason: "Family moved back to the area", requestedAt: "2026-11-05T09:00:00Z" }],
    )
    expect(list).toEqual([
      {
        key: "reopening-r1",
        icon: "reopen",
        title: "New reopening request",
        caption: "Juma Khamis Ali · Family moved back to the area",
        href: "/staff/reopenings",
        requestedAt: "2026-11-05T09:00:00Z",
      },
      {
        key: "discount-d1",
        icon: "discounts",
        title: "New discount request",
        caption: "Rehema Ali · Staff child (25% off) · Mother teaches FORM 2",
        href: "/staff/discounts",
        requestedAt: "2026-11-02T09:00:00Z",
      },
    ])
  })

  it("cuts a long note to one short line and leaves out an empty one", () => {
    const [long] = bellRequests([], [{ id: "r", studentName: "A", reason: `${"word ".repeat(30)}\n\nend`, requestedAt: "2026-11-05T09:00:00Z" }])
    expect(long.caption.length).toBeLessThanOrEqual(64)
    expect(long.caption.endsWith("…")).toBe(true)
    expect(long.caption).not.toContain("\n")
    const [empty] = bellRequests([{ id: "d", studentName: "B", kind: "qualified_orphan", note: "  ", requestedAt: "2026-11-05T09:00:00Z" }], [])
    expect(empty.caption).toBe("B · Qualified orphan (100% off)")
  })

  it("is empty when nothing waits", () => {
    expect(bellRequests([], [])).toEqual([])
  })
})
