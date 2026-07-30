import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GiwaPay — Pay with anything. Settle exactly.',
  description:
    'GIWA 기반 비수탁 exact-settlement 결제 레이어의 제품 적합성, 검증 가능한 Testnet MVP와 명확한 구현 경계.',
  metadataBase: new URL('https://giwapay-mvp.eomyunsig.chatgpt.site'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'GiwaPay — Pay with anything. Settle exactly.',
    description:
      "GiwaPay's GIWA fit, exact-settlement testnet MVP, verification evidence, and honest product boundaries.",
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
    description: 'GIWA fit and public GIWA Sepolia testnet MVP showcase.',
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
