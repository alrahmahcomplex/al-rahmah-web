import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import { estimateFormDiscountCode, formDiscountCodeToKeep, withoutBoxHyphen } from "@/lib/services/referral"

// The Admission form's code lookup (#403): as typed first, then without the
// hyphen the code box adds, for Promo codes, which never hold one.

type Answer = { state: string; amount: number }

function client(known: Record<string, Answer>, asked: string[] = []): SupabaseClient {
  return {
    rpc: (_name: string, { code }: { code: string }) => ({
      single: async () => {
        asked.push(code)
        return { data: known[code] ?? { state: "unknown", amount: 50000 }, error: null }
      },
    }),
  } as unknown as SupabaseClient
}

describe("the code without the box's hyphen", () => {
  it("is there only for one to three letters, a hyphen and digits", () => {
    expect(withoutBoxHyphen("EID-2026")).toBe("EID2026")
    expect(withoutBoxHyphen("AB-12")).toBe("AB12")
    expect(withoutBoxHyphen("KARIBU2026")).toBeNull()
    expect(withoutBoxHyphen("SAVE10")).toBeNull()
    expect(withoutBoxHyphen("2026")).toBeNull()
    expect(withoutBoxHyphen("ABCD-12")).toBeNull()
  })
})

describe("looking a form's code up", () => {
  it("finds a Promo code without the hyphen when nothing holds the typed code", async () => {
    const asked: string[] = []
    const found = await estimateFormDiscountCode(client({ EID2026: { state: "approved", amount: 35000 } }, asked), "EID-2026")
    expect(found).toEqual({ ok: true, data: { state: "approved", amount: 35000, code: "EID2026" } })
    expect(asked).toEqual(["EID-2026", "EID2026"])
  })

  it("keeps a code that matches as typed and asks once", async () => {
    const asked: string[] = []
    const found = await estimateFormDiscountCode(client({ "BJN-402": { state: "pending", amount: 50000 } }, asked), "BJN-402")
    expect(found).toEqual({ ok: true, data: { state: "pending", amount: 50000, code: "BJN-402" } })
    expect(asked).toEqual(["BJN-402"])
  })

  it("keeps the typed code when neither matches", async () => {
    expect(await estimateFormDiscountCode(client({}), "QZ-1")).toEqual({ ok: true, data: { state: "unknown", amount: 50000, code: "QZ-1" } })
  })

  it("keeps on the lead the code it found, and looks up only codes of the box's shape", async () => {
    const asked: string[] = []
    const promo = client({ EID2026: { state: "approved", amount: 35000 } }, asked)
    expect(await formDiscountCodeToKeep(promo, "EID-2026")).toBe("EID2026")
    expect(await formDiscountCodeToKeep(promo, "KARIBU2026")).toBe("KARIBU2026")
    expect(asked).toEqual(["EID-2026", "EID2026"])
  })

  it("keeps the typed code when the lookup can't run", async () => {
    const down = { rpc: () => ({ single: async () => ({ data: null, error: { message: "down" } }) }) } as unknown as SupabaseClient
    expect(await formDiscountCodeToKeep(down, "EID-2026")).toBe("EID-2026")
  })
})
