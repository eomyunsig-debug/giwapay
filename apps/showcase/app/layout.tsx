import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GiwaPay — Pay with anything. Settle exactly.',
  description:
    'GIWA 기반 비수탁 exact-settlement 결제 오케스트레이션 레이어의 공개 Testnet MVP showcase.',
  metadataBase: new URL('https://giwapay-mvp.eomyunsig.chatgpt.site'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'GiwaPay — Pay with anything. Settle exactly.',
    description:
      "A public, non-transactional showcase of GiwaPay's testnet MVP and security boundaries.",
    type: 'website',
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
