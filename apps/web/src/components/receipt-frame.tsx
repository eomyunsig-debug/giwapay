import type { ReactNode } from 'react';

import { Brand } from './brand';
import { LanguageToggle } from './language-toggle';

export function AsyncReceiptFrame({ children }: { children: ReactNode }) {
  return (
    <main className="checkout-page" id="main-content">
      <header className="checkout-header">
        <Brand />
        <div className="header-actions">
          <span className="secure-label">
            <span className="network-dot" /> GIWA Sepolia receipt
          </span>
          <LanguageToggle />
        </div>
      </header>
      <div className="receipt-card gp-card">{children}</div>
    </main>
  );
}
