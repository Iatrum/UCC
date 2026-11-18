/** @type {import('next').NextConfig} */

const nextConfig = {
  poweredByHeader: false,
  // Viewer launch URLs carry a bearer capability; keep them out of the dev request log.
  logging: { incomingRequests: { ignore: [/\/api\/pacs\/viewer\/launch(?:\?|$)/] } },
  transpilePackages: [
    '@tiptap/react',
    '@tiptap/core',
    '@tiptap/pm',
    '@tiptap/starter-kit',
    '@tiptap/extension-placeholder',
  ],
  outputFileTracingRoot: __dirname,
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    optimizePackageImports: [
      "lucide-react",
    ],
  },
  images: {
    // Consider configuring domains for optimized images; keeping unoptimized off for prod
    unoptimized: false,
    remotePatterns: [
      { protocol: 'https', hostname: '**.googleusercontent.com' },
      { protocol: 'https', hostname: '**.firebaseapp.com' },
      { protocol: 'https', hostname: '**.firebasestorage.googleapis.com' },
    ],
  },
  async redirects() {
    return [
      {
        source: "/patients/:id/triage",
        destination: "/patients/:id/check-in",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Legacy twin of CSP frame-ancestors 'none'. All in-app iframes are srcDoc/blob previews
          // (child frames of our own page), so no own-origin page is ever framed.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // Content-Security-Policy is set per request (with a nonce) in proxy.ts via lib/security/csp.ts.
        ],
      },
    ];
  },
  webpack: (config, { dev }) => {
    // Opt-in for the small local e2e box; keep production compilation unchanged.
    if (dev && process.env.UCC_LOW_MEMORY_DEV === '1') {
      config.cache = false;
      config.devtool = false;
    }
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    config.resolve.fallback = {
      ...config.resolve.fallback,
      canvas: false,
      encoding: false,
    };
    return config;
  }
};

module.exports = nextConfig;
