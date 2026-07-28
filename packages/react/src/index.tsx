'use client';

import {
  createContext,
  useContext,
  useMemo,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { GiwaPayClient, PaymentIntent, PaymentStatus } from '@giwapay/sdk';

const GiwaPayContext = createContext<GiwaPayClient | null>(null);

export interface GiwaPayProviderProps {
  client: GiwaPayClient;
  queryClient?: QueryClient;
  children: ReactNode;
}

export function GiwaPayProvider({ client, queryClient, children }: GiwaPayProviderProps) {
  const fallbackQueryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: true,
            retry: 1,
            staleTime: 2_000,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient ?? fallbackQueryClient}>
      <GiwaPayContext.Provider value={client}>{children}</GiwaPayContext.Provider>
    </QueryClientProvider>
  );
}

export function useGiwaPayClient(): GiwaPayClient {
  const client = useContext(GiwaPayContext);
  if (!client) {
    throw new Error('useGiwaPayClient must be used within GiwaPayProvider');
  }
  return client;
}

const shouldPoll = (status?: PaymentStatus): boolean =>
  status === 'created' || status === 'submitted' || status === 'partially_refunded';

/**
 * Backend state remains authoritative. Submitted wallet transactions are not
 * treated as payment success until the independent indexer verifies the event.
 */
export function usePaymentIntent(id: string): UseQueryResult<PaymentIntent, Error> {
  const client = useGiwaPayClient();
  return useQuery({
    queryKey: ['giwapay', 'payment-intent', id],
    queryFn: async () => (await client.getPaymentIntent(id)).paymentIntent,
    enabled: id.length > 0,
    refetchInterval: (query) => (shouldPoll(query.state.data?.status) ? 2_000 : false),
  });
}

export interface CheckoutButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  paymentIntentId: string;
  checkoutBaseUrl?: string;
  children?: ReactNode;
}

export function CheckoutButton({
  paymentIntentId,
  checkoutBaseUrl,
  children = 'Pay with GiwaPay',
  className,
  ...props
}: CheckoutButtonProps) {
  const path = `/checkout/${encodeURIComponent(paymentIntentId)}`;
  const href = checkoutBaseUrl ? `${checkoutBaseUrl.replace(/\/$/, '')}${path}` : path;

  return (
    <a
      href={href}
      className={['giwapay-checkout-button', className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </a>
  );
}
