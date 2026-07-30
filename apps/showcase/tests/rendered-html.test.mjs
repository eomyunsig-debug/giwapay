import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';

async function render() {
  const workerUrl = new URL('../dist/server/index.js', import.meta.url);
  workerUrl.searchParams.set('test', `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new globalThis.Request('http://localhost/', {
      headers: { accept: 'text/html' },
    }),
    {
      ASSETS: {
        fetch: async () => new globalThis.Response('Not found', { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test('server-renders the public GiwaPay showcase', async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>GiwaPay — Public Testnet MVP Showcase<\/title>/i);
  assert.match(html, /Pay with anything/);
  assert.match(html, /Settle/);
  assert.match(html, /GIWA Sepolia · Testnet MVP/);
  assert.match(html, /ENGLISH/);
  assert.match(html, /한국어/);
  assert.match(html, /결제는 자유롭게.*정산은.*정확하게/s);
  assert.match(html, /Three steps\. That is it\./);
  assert.match(html, /Explore the repository/);
  assert.match(html, /Read the GASOK brief/);
  assert.match(html, /Testnet checkout preview/);
  assert.match(html, /Live GIWA Sepolia contracts and payment execution are not deployed yet/);
  assert.match(html, /https:\/\/github\.com\/eomyunsig-debug\/giwapay/);
  assert.match(html, /Not audited/);
  assert.match(html, /property="og:image"[^>]+\/og\.png/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
});

test('keeps operating and security detail in a closed native disclosure', async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /<details class="operations-disclosure">/);
  assert.match(html, /<summary>.*How it works and security boundaries.*<\/summary>/s);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/);
  assert.match(html, /Merchant signed/);
  assert.match(html, /Independent verification/);
  assert.match(html, /SECURITY BOUNDARIES/);
});

test('explains GIWA fit without claiming unreleased or exchange integrations', async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /WHY GIWA/);
  assert.match(html, /Built for the ecosystem GIWA says it is building/);
  assert.match(html, /GIWA SEPOLIA TESTNET AVAILABLE/);
  assert.match(html, /OFFICIAL ECOSYSTEM · NOT INTEGRATED/);
  assert.match(html, /GIWA testnet is separate from the Upbit exchange service/);
  assert.match(html, /giwa-ecosystem\/dojang/);
  assert.match(html, /giwa-ecosystem\/giwa-id/);
  assert.match(html, /giwa-wallet-embedded-mode\.md/);
  assert.match(html, /gasok-one-pager\.md/);
  assert.match(html, /market-opportunity\.md/);
  assert.match(html, /GiwaPay-GASOK-Pitch-Deck\.pdf/);
  assert.match(html, /gasok-judge-evidence\.md/);
  assert.match(html, /blob\/main\/docs\/gasok-application\.md/);
  assert.match(html, /blob\/main\/docs\/gasok-one-pager\.md/);
  assert.match(html, /blob\/main\/docs\/gasok-judge-evidence\.md/);
  assert.doesNotMatch(html, /GIWA Wallet integration complete/i);
  assert.doesNotMatch(html, /Upbit liquidity/i);
});

test('does not present a fake checkout success or wallet action', async () => {
  const response = await render();
  const html = await response.text();
  assert.doesNotMatch(html, /Connect wallet/i);
  assert.doesNotMatch(html, /Pay now/i);
  assert.doesNotMatch(html, /0x[a-fA-F0-9]{64}/);
  assert.doesNotMatch(html, /payment succeeded/i);
});
