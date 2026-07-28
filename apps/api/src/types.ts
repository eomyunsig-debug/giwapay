import type { Database, Merchant } from '@giwapay/db';
import type { Pool } from 'pg';

import type { createChainClient } from './chain.js';
import type { AppConfig } from './env.js';
import type { PaymentIntentSigner } from './signer.js';

export type AuthPrincipal = {
  merchantId: string;
  merchant: Merchant;
  authType: 'session' | 'api_key';
  scopes: readonly string[];
  sessionId?: string;
  apiKeyId?: string;
};

export type AppServices = {
  config: AppConfig;
  db: Database;
  pool: Pool;
  chainClient: ReturnType<typeof createChainClient>;
  intentSigner: PaymentIntentSigner;
};

declare module 'fastify' {
  interface FastifyRequest {
    principal?: AuthPrincipal;
  }
}
