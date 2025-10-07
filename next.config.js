/** @type {import('next').NextConfig} */

// ---- Security Headers (CSP for Supabase + Cloudflare Turnstile + Cloudflare Insights) ----
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
      'upgrade-insecure-requests',

      // --- Scripts ---
      // Nextのインライン/ハイドレーション, Turnstile, Cloudflare Insights(スクリプトCDN)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
      // タグ由来のスクリプトにも同じ許可を明示（Chromeの警告回避）
      "script-src-elem 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
      // on* の属性実行は不可（安全強化・任意）
      "script-src-attr 'none'",

      // --- Frames (Turnstile widget) ---
      "frame-src 'self' https://challenges.cloudflare.com",

      // --- Network calls ---
      // Supabase (REST/Realtime/Storage) + Turnstile 検証 + Insights 送信先
      "connect-src 'self' https://*.supabase.co https://*.supabase.in https://*.supabase.net https://challenges.cloudflare.com https://cloudflareinsights.com https://static.cloudflareinsights.com wss://*.supabase.co wss://*.supabase.in wss://*.supabase.net",

      // --- Images ---
      // Supabase public objects / data: / blob: / Turnstile / Insights
      "img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://*.supabase.net https://challenges.cloudflare.com https://static.cloudflareinsights.com",

      // --- Styles/Fonts ---
      // Tailwind/Nextのインラインstyle、Google Fonts、Bootstrap CDN
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://maxcdn.bootstrapcdn.com",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://maxcdn.bootstrapcdn.com",
      "font-src 'self' data: https://fonts.gstatic.com https://maxcdn.bootstrapcdn.com",

      // --- Workers (some Next features/dev) ---
      "worker-src 'self' blob:",

      // 任意だが noise を減らす
      "manifest-src 'self'",
      "media-src 'self' blob: data:"
      // ⬇️ ここにあった prefetch-src は削除（仕様外でブラウザ警告の原因）
    ].join('; ')
  },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // 互換のため残す（実質は frame-ancestors が有効）
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
];

const nextConfig = {
  reactStrictMode: true,

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: '*.supabase.in', pathname: '/storage/v1/object/public/**' },
      { protocol: 'https', hostname: '*.supabase.net', pathname: '/storage/v1/object/public/**' }
    ]
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders
      }
    ];
  },

  // 旧パスを新へ統一
  async redirects() {
    return [
      { source: '/matches/register', destination: '/matches/register/singles', permanent: true },
      { source: '/matches/register/', destination: '/matches/register/singles', permanent: true }
    ];
  }
};

module.exports = nextConfig;
