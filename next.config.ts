import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '10mb' } },
  async redirects() {
    return [
      { source: '/favicon.ico', destination: '/icons/app-icon.svg', permanent: true },
      { source: '/dashboard', destination: '/', permanent: true },
      { source: '/admin/:path*', destination: '/', permanent: true },
      { source: '/people/:path*', destination: '/customers/:path*', permanent: true },
      { source: '/accounts', destination: '/finance', permanent: true },
      {
        source: '/:legacy(gift-cards|minecraft|subscriptions|products|about|contact|services|transfers|pc-parts|store|cart)/:path*',
        destination: '/',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' }],
      },
    ];
  },
};

export default nextConfig;
