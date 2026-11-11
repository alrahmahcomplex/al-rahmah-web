import AxeBuilder from "@axe-core/playwright"
import { expect, type Locator, type Page } from "@playwright/test"

// The one axe helper for the staff app (#322). It reports every finding but
// the two the owner accepted:
// - white on Sunrise Orange #ee7300 (DESIGN.md, The ShuleFasta Button Rule);
// - the old look's destructive badge (components/ui/badge, variant
//   "destructive"), until its screen converts.

/** Waits until an overlay has finished opening, so colours are not caught mid-fade. */
export async function settled(overlay: Locator) {
  await expect.poll(() => overlay.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
}

/** Axe's findings as "rule: target", less the two accepted ones; `include` narrows the scan, as to an open overlay. */
export async function axeProblems(page: Page, include?: string): Promise<string[]> {
  if (include) await settled(page.locator(include))
  const builder = new AxeBuilder({ page })
  if (include) builder.include(include)
  const results = await builder.analyze()
  return results.violations.flatMap((violation) =>
    violation.nodes
      .filter((node) => {
        if (violation.id !== "color-contrast") return true
        const whiteOnOrange = node.any.some((check) => check.data?.fgColor === "#ffffff" && check.data?.bgColor === "#ee7300")
        const destructiveBadge = /data-variant="destructive"/.test(node.html) && /data-slot="badge"/.test(node.html)
        return !whiteOnOrange && !destructiveBadge
      })
      .map((node) => `${violation.id}: ${node.target.join(" ")}`),
  )
}
