import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Lets staff pages call forbidden() for someone whose role lacks the
    // permission a page needs.
    authInterrupts: true,
  },
  async redirects() {
    return [
      // One sign-in page for everyone (#264). Old emails, bookmarks and
      // printed links to the Discount code sign-in pages keep working.
      { source: "/discount-code/sign-in", destination: "/login", permanent: true },
      { source: "/discount-code/forgot-password", destination: "/login/forgot-password", permanent: true },
      // Every reset lands on one page (#265). Reset links sent before it
      // keep working: the query, token and all, comes along.
      { source: "/discount-code/reset-password", destination: "/login/reset-password", permanent: true },
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
};

export default nextConfig;
