"use client"

import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"

import { insightsUrl } from "@/lib/insights-url"

// Vercel Web Analytics (page views) and Speed Insights (page speed), both
// sending only the address insightsUrl allows. A client component because
// beforeSend is a function, which a server layout can't pass down.
export function VercelInsights() {
  return (
    <>
      <Analytics beforeSend={(event) => ({ ...event, url: insightsUrl(event.url) })} />
      <SpeedInsights beforeSend={(event) => ({ ...event, url: insightsUrl(event.url) })} />
    </>
  )
}
