import { redirect } from 'next/navigation';

export default async function LegacyPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/checkout/${encodeURIComponent(id)}`);
}
