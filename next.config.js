/** @type {import('next').NextConfig} */

// ---- Security Headers (CSP tuned for Supabase + Cloudflare Turnstile + fonts) ----
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'self'",

      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
      "frame-src 'self' https://challenges.cloudflare.com",

      "connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.supabase.net https://challenges.cloudflare.com wss://*.supabase.co wss://*.supabase.in wss://*.supabase.net",

      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://*.supabase.net https://challenges.cloudflare.com",

      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://maxcdn.bootstrapcdn.com",
      "font-src 'self' data: https://fonts.gstatic.com https://maxcdn.bootstrapcdn.com",

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

  /**
   * ✅ 追加：/api/matches/:matchId/report を /api/matches/report?matchId=... に rewrite
   * - 本番で /api/matches/<uuid>/report が 404 になる症状を確実に回避する
   * - beforeFiles に入れることで filesystem route より先に適用される
   */
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/matches/:matchId/report',
          destination: '/api/matches/report?matchId=:matchId',
        },
        {
          source: '/api/matches/:matchId/report/',
          destination: '/api/matches/report?matchId=:matchId',
        },
      ],
    };
  },
};

module.exports = nextConfig;
