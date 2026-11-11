import type { NextConfig } from "next";

import { LANGUAGE_STATE_PREFIX, languageStateRewrites } from "./lib/language-state";

const nextConfig: NextConfig = {
  experimental: {
    // Lets staff pages call forbidden() for someone whose role lacks the
    // permission a page needs.
    authInterrupts: true,
  },
  async headers() {
    // A page's address can hold a sign-in link token, a Discount code or a
    // name staff searched for. The next page, and anything measuring it,
    // learns only which site the visitor came from, never the full address.
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "strict-origin" }] }];
  },
  async redirects() {
    return [
      // The per-language copies are reached only through the rewrites below
      // (#286). Opened directly, they send the visitor to the public address,
      // where the cookie picks the copy.
      { source: `${LANGUAGE_STATE_PREFIX}/:state/:path*`, destination: "/:path*", permanent: false },
      // One sign-in page for everyone (#264). Old emails, bookmarks and
      // printed links to the Discount code sign-in pages keep working.
      { source: "/discount-code/sign-in", destination: "/login", permanent: true },
      { source: "/discount-code/forgot-password", destination: "/login/forgot-password", permanent: true },
      // Every reset lands on one page (#265). Reset links sent before it
      // keep working: the query, token and all, comes along.
      { source: "/discount-code/reset-password", destination: "/login/reset-password", permanent: true },
      // The staff list of applicants moved from /staff/leads. Bookmarks and
      // links in old messages keep working, query and all.
      { source: "/staff/leads", destination: "/staff/applicants", permanent: true },
      { source: "/staff/leads/:path*", destination: "/staff/applicants/:path*", permanent: true },
      {
        // An invite link lands on the site root when it was sent with no
        // redirect (from the Supabase dashboard, for the first staff member)
        // or with one the redirect allow-list refused. Supabase then fills
        // the template's {{ .RedirectTo }} with the Site URL. Sending it on
        // to /auth/confirm, query and all, keeps the invite usable without
        // the public home page reading anything.
        source: "/",
        has: [
          { type: "query", key: "type", value: "invite" },
          { type: "query", key: "token_hash" },
        ],
        destination: "/auth/confirm",
        permanent: false,
      },
      {
        // The same for a reset sent from the Supabase dashboard (#265).
        source: "/",
        has: [
          { type: "query", key: "type", value: "recovery" },
          { type: "query", key: "token_hash" },
        ],
        destination: "/login/reset-password",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return {
      // Before the filesystem and dynamic routes: the public address of a
      // cached page goes to its copy for the visitor's `lang` cookie, with no
      // function run (lib/language-state.ts, ADR 0006).
      beforeFiles: languageStateRewrites(),
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
