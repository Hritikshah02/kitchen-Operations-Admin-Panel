import type { NextConfig } from "next";

// The browser only ever calls /api/* on this origin; Next forwards it to the NestJS API over HTTP.
// Keeping one origin makes the auth cookie first-party (SameSite=Lax works, no third-party cookie blocking).
// No business logic lives here - it is a pure pass-through.
const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:3001").replace(/\/$/, "");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(), microphone=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
