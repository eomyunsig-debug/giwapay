import { ArrowLeft, ExternalLink, KeyRound, Terminal } from 'lucide-react';
import Link from 'next/link';

import { Brand } from '@/components/brand';
import { Card } from '@giwapay/ui';
import { API_BASE_URL } from '@/lib/config';

export default function DocsPage() {
  return (
    <main className="checkout-page" id="main-content">
      <header className="checkout-header">
        <Brand />
        <Link className="header-link" href="/">
          <ArrowLeft size={13} /> Back
        </Link>
      </header>
      <div style={{ width: 'min(100%, 900px)', margin: '35px auto' }}>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Developer quickstart</p>
            <h1>Accept an exact-settlement payment</h1>
            <p>
              Create intents from a trusted server. Never place a merchant API key or delegated
              signing key in browser code.
            </p>
          </div>
          <a className="action-link" href={`${API_BASE_URL}/docs`} target="_blank" rel="noreferrer">
            OpenAPI <ExternalLink size={14} />
          </a>
        </div>

        <Card className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h2>
              <KeyRound size={15} style={{ verticalAlign: '-2px' }} /> 1. Create an API key
            </h2>
          </div>
          <div className="panel-body">
            Complete wallet sign-in and onchain merchant registration, then create a scoped key in
            the merchant dashboard. The secret is shown exactly once.
          </div>
        </Card>

        <Card className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h2>
              <Terminal size={15} style={{ verticalAlign: '-2px' }} /> 2. Create a PaymentIntent
            </h2>
          </div>
          <div className="panel-body">
            <pre className="secret-value" style={{ whiteSpace: 'pre-wrap' }}>
              {`import { GiwaPayClient } from "@giwapay/sdk";

const giwaPay = new GiwaPayClient({
  baseUrl: process.env.GIWAPAY_API_URL!,
  apiKey: process.env.GIWAPAY_API_KEY!,
});

const result = await giwaPay.createPaymentIntent({
  idempotencyKey: crypto.randomUUID(),
  description: "Order #1042",
  settlementToken: process.env.GIWA_SETTLEMENT_TOKEN!,
  settlementAmount: "48000000000",
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
});

// Redirect the customer to the API-returned URL.
console.log(result.checkoutUrl);`}
            </pre>
          </div>
        </Card>

        <Card className="panel">
          <div className="panel-header">
            <h2>3. Trust verified state only</h2>
          </div>
          <div className="panel-body">
            <p>
              A wallet transaction hash is not payment success. Fulfill only after the PaymentIntent
              API reports <code>succeeded</code> or a signed webhook reports the independently
              verified event.
            </p>
            <div className="info-banner">
              GIWA Sepolia chain ID: 91342 · Native currency: ETH · Public RPC may be rate-limited
              and should be replaced for production-like workloads.
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
