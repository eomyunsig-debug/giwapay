'use client';

import { useState, type ReactNode } from 'react';
import { GiwaPayProvider } from '@giwapay/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fallback, http } from 'viem';
import { WagmiProvider, createConfig } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';

import { giwaPayClient } from '@/lib/api';
import { giwaRpcUrls, webGiwaSepolia } from '@/lib/config';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const connectors = [
  injected({ shimDisconnect: true }),
  ...(walletConnectProjectId
    ? [
        walletConnect({
          projectId: walletConnectProjectId,
          metadata: {
            name: 'GiwaPay',
            description: 'Non-custodial exact-settlement payments',
            url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
            icons: [],
          },
          showQrModal: true,
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [webGiwaSepolia],
  connectors,
  multiInjectedProviderDiscovery: true,
  ssr: true,
  transports: {
    [webGiwaSepolia.id]: fallback(
      giwaRpcUrls.map((url) =>
        http(url, {
          timeout: 10_000,
          retryCount: 3,
          retryDelay: 250,
        }),
      ),
      { retryCount: 1, retryDelay: 250 },
    ),
  },
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: true,
            staleTime: 2_000,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <GiwaPayProvider client={giwaPayClient} queryClient={queryClient}>
          {children}
        </GiwaPayProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
