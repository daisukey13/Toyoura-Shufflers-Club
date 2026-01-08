/** @type {import('next').NextConfig} */

// ---- Security Headers (CSP tuned for Supabase + Cloudflare Turnstile + fonts) ----
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      // Baseline
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'self'",

      // Scripts (Cloudflare Turnstile)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",

      // Frames (Turnstile widget)
      "frame-src 'self' https://challenges.cloudflare.com",

      // Network calls (Supabase APIs/Realtime/Storage + Turnstile)
      // Realtime は wss を許可
      "connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.supabase.net https://challenges.cloudflare.com wss://*.supabase.co wss://*.supabase.in wss://*.supabase.net",

      // Images (Supabase public objects, data/blob, Turnstile assets)
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://*.supabase.net https://challenges.cloudflare.com",

      // Styles (allow inline for Tailwind/Next style tags + optional providers)
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://maxcdn.bootstrapcdn.com",

      // Fonts (allow data: and CDN fonts to avoid CSP errors)
      "font-src 'self' data: https://fonts.gstatic.com https://maxcdn.bootstrapcdn.com",

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

  /**
   * ✅ next/image 許可（最小修正）
   * - wildcard hostname は Next の remotePatterns では期待通り動かないため、プロジェクト固有 host を明示
   * - /public だけでなく /sign も通すため pathname を /storage/v1/object/** に広げる
   */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cpfyaezsyvjjwpbuhewa.supabase.co',
        pathname: '/storage/v1/object/**',
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

  // 旧: /matches/register -> 新: /matches/register/singles に統一
  async redirects() {
    return [
      { source: '/matches/register', destination: '/matches/register/singles', permanent: true },
      { source: '/matches/register/', destination: '/matches/register/singles', permanent: true },
    ];
  },
};

module.exports = nextConfig;
