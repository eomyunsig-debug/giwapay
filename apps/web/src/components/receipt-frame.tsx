import type { ReactNode } from 'react';

import { Brand } from './brand';

export function AsyncReceiptFrame({ children }: { children: ReactNode }) {
  return (
    <main className="checkout-page" id="main-content">
      <header className="checkout-header">
        <Brand />
        <span className="secure-label">
          <span className="network-dot" /> GIWA Sepolia receipt
        </span>
      </header>
      <div className="receipt-card gp-card">{children}</div>
    </main>
  );
}
