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
  assert.match(html, /Public showcase · Testnet MVP/);
  assert.match(html, /Live GIWA Sepolia contracts and payment execution are not deployed yet/);
  assert.match(html, /https:\/\/github\.com\/eomyunsig-debug\/giwapay/);
  assert.match(html, /Not audited/);
});

test('does not present a fake checkout success or wallet action', async () => {
  const response = await render();
  const html = await response.text();
  assert.doesNotMatch(html, /Connect wallet/i);
  assert.doesNotMatch(html, /Pay now/i);
  assert.doesNotMatch(html, /0x[a-fA-F0-9]{64}/);
  assert.doesNotMatch(html, /payment succeeded/i);
});
