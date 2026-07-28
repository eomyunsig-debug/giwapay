import type { Metadata } from 'next';

import { CheckoutClient } from '@/components/checkout-client';

export const metadata: Metadata = {
  title: 'Secure checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckoutClient id={id} />;
}
