import type { ReactNode } from 'react';

import { IS_LOCAL_ANVIL_DEMO } from '@/lib/config';
import { Brand } from './brand';
import { LanguageToggle } from './language-toggle';

export function AsyncReceiptFrame({ children }: { children: ReactNode }) {
  return (
    <main className="checkout-page" id="main-content">
      <header className="checkout-header">
        <Brand network={IS_LOCAL_ANVIL_DEMO ? 'Anvil' : 'Sepolia'} />
        <div className="header-actions">
          <span className="secure-label">
            <span className="network-dot" />{' '}
            {IS_LOCAL_ANVIL_DEMO ? 'Local Anvil receipt' : 'GIWA Sepolia receipt'}
          </span>
          <LanguageToggle />
        </div>
      </header>
      <div className="receipt-card gp-card">{children}</div>
    </main>
  );
}
