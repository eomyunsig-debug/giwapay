import type { NextConfig } from 'next';
import {
  buildContentSecurityPolicy,
  safeConfiguredConnectOrigins,
  walletConnectRelayOrigins,
} from './src/lib/csp';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@giwapay/chains', '@giwapay/react', '@giwapay/sdk', '@giwapay/ui'],
  env: {
    NEXT_PUBLIC_GIWA_RPC_URL:
      process.env.NEXT_PUBLIC_GIWA_RPC_URL ??
      process.env.GIWA_RPC_URL ??
      'https://sepolia-rpc.giwa.io',
    NEXT_PUBLIC_GIWA_RPC_FALLBACK_URLS:
      process.env.NEXT_PUBLIC_GIWA_RPC_FALLBACK_URLS ?? process.env.GIWA_RPC_FALLBACK_URLS ?? '',
  },
  async headers() {
    const configuredConnectOrigins = safeConfiguredConnectOrigins([
      process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001',
      process.env.NEXT_PUBLIC_GIWA_RPC_URL ??
        process.env.GIWA_RPC_URL ??
        'https://sepolia-rpc.giwa.io',
      process.env.NEXT_PUBLIC_GIWA_RPC_FALLBACK_URLS,
      process.env.GIWA_RPC_FALLBACK_URLS,
      ...walletConnectRelayOrigins(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
    ]);
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: buildContentSecurityPolicy({
              connectOrigins: configuredConnectOrigins,
              isDevelopment: process.env.NODE_ENV !== 'production',
            }),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
