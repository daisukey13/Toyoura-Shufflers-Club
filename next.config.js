/** @type {import('next').NextConfig} */

// ---- Security Headers (CSP tuned for Supabase + Cloudflare Turnstile) ----
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      // Baseline
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",

      // Scripts (Turnstile)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",

      // Frames (Turnstile widget)
      "frame-src https://challenges.cloudflare.com",

      // Network calls (Supabase APIs/Realtime/Storage + Turnstile)
      "connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.supabase.net https://challenges.cloudflare.com",

      // Images (Supabase public objects, data/blob, Turnstile assets)
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://challenges.cloudflare.com",

      // Styles (allow inline for Tailwind/Next style tags)
      "style-src 'self' 'unsafe-inline'",

      // Fonts (avoid console warnings when using data: fonts)
      "font-src 'self' data:",

      // Workers (Next dev / client features)
      "worker-src 'self' blob:",
    ].join('; '),
  },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  reactStrictMode: true,

  // next/image: allow Supabase Storage public bucket images
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.in',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
