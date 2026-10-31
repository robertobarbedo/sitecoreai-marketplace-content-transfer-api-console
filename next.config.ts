import type { NextConfig } from "next";

// The app only runs inside the SitecoreAI iframe, so framing is limited to
// SitecoreAI hosts. Override with CSP_FRAME_ANCESTORS (space-separated
// sources) if Sitecore embeds the app from another host.
const frameAncestors =
  process.env.CSP_FRAME_ANCESTORS ?? "'self' https://*.sitecorecloud.io";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: `frame-ancestors ${frameAncestors}` },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "js", "jsx"],
  poweredByHeader: false,
  // No next/image in this app: keeps the optional sharp (LGPL) binary unused
  images: { unoptimized: true },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
