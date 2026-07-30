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
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'GiwaPay — Pay with anything. Settle exactly.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GiwaPay — Pay with anything. Settle exactly.',
    description: 'Public GIWA Sepolia testnet MVP showcase.',
    images: ['/og.png'],
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
    <html lang="en" data-showcase-locale="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
