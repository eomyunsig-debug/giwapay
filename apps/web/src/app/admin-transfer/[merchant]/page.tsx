import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isAddress } from 'viem';

import { AdminTransferClient } from '@/components/admin-transfer-client';

export const metadata: Metadata = {
  title: 'Accept merchant admin transfer',
  robots: { index: false, follow: false },
};

export default async function AdminTransferPage({
  params,
}: {
  params: Promise<{ merchant: string }>;
}) {
  const { merchant } = await params;
  if (!isAddress(merchant)) notFound();
  return <AdminTransferClient merchant={merchant} />;
}
