import type { NextConfig } from "next";

import { LANGUAGE_STATE_PREFIX, languageStateRewrites } from "./lib/language-state";
import {
  agentsHostRewrites,
  appRootRedirects,
  crossHostRedirects,
  movedAgentStudentsRedirect,
  movedSignInRedirects,
  rootEmailLinkRedirects,
} from "./lib/site-hosts";

const nextConfig: NextConfig = {
  experimental: {
    // Makes app/staff/forbidden.tsx a forbidden() boundary. Staff pages return
    // that page themselves rather than calling forbidden() (#441).
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
      // The portal's pages move to its own host, and a Referral link opened
      // there goes to the public site (#497, lib/site-hosts.ts). Production
      // hosts only; first, so the rules below then run on the right host.
      ...crossHostRedirects(),
      // Sign-in moved from /login to /auth (#497 slice C), and the Discount
      // code sign-in pages before it (#264, #265). Old links keep working,
      // query and all.
      ...movedSignInRedirects(),
      // The agent dashboard moved from /discount-code/students to /home (#539).
      movedAgentStudentsRedirect(),
      // The per-language copies are reached only through the rewrites below
      // (#286). Opened directly, they send the visitor to the public address,
      // where the cookie picks the copy.
      { source: `${LANGUAGE_STATE_PREFIX}/:state/agents-auth/:path*`, destination: "/auth/:path*", permanent: false },
      { source: `${LANGUAGE_STATE_PREFIX}/:state/:path*`, destination: "/:path*", permanent: false },
      // The staff list of applicants moved from /staff/leads. Bookmarks and
      // links in old messages keep working, query and all.
      { source: "/staff/leads", destination: "/staff/applicants", permanent: true },
      { source: "/staff/leads/:path*", destination: "/staff/applicants/:path*", permanent: true },
      // An invite or reset link on the site root goes on to its page.
      ...rootEmailLinkRedirects(),
      // After those: both app hosts' roots open sign-in.
      ...appRootRedirects(),
    ];
  },
  async rewrites() {
    return {
      // Before the filesystem and dynamic routes: per-host manifest, icons and
      // cached /auth/forgot-password theme for agents. (#539), then the
      // per-language cached copies (lib/language-state.ts, ADR 0006).
      beforeFiles: [...agentsHostRewrites(), ...languageStateRewrites()],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
