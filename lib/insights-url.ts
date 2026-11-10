// What Vercel Web Analytics and Speed Insights may learn about a page: its
// address without the query string or fragment, and with record ids masked.
// Query strings carry sign-in link tokens, Discount codes and the names staff
// type into search, so they never leave the browser.

const RECORD_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export function insightsUrl(url: string): string {
  return url.split(/[?#]/, 1)[0].replace(RECORD_ID, "[id]")
}
