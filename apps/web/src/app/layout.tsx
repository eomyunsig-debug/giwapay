import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'GiwaPay — Pay with anything. Settle exactly.',
    template: '%s · GiwaPay',
  },
  description:
    '사용자는 가진 자산으로 결제하고, 판매자는 선택한 자산과 정확한 금액으로 정산받는 GIWA 기반 비수탁 결제 레이어.',
  applicationName: 'GiwaPay',
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f7f8f4',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" data-locale="ko" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
