/**
 * The browser tab's title for a staff page: the page title, then the school.
 * Use it in the page's `metadata` (or `generateMetadata`) so the tab and the
 * header say the same thing.
 */
export function pageTitle(title: string): string {
  return `${title} · Al-Rahmah Complex`
}
