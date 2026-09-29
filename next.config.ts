import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Lets staff pages call forbidden() for someone whose role lacks the
    // permission a page needs.
    authInterrupts: true,
  },
  async redirects() {
    return [
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
    ];
  },
};

export default nextConfig;
