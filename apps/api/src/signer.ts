import type { Merchant } from '@giwapay/db';
import { privateKeyToAccount } from 'viem/accounts';

import { paymentIntentTypes } from './abi.js';
import type { AppConfig } from './env.js';
import { HttpError } from './errors.js';

export type UnsignedPaymentIntent = {
  intentId: `0x${string}`;
  merchant: `0x${string}`;
  settlementToken: `0x${string}`;
  settlementAmount: bigint;
  splitId: `0x${string}`;
  splitHash: `0x${string}`;
  platformFee: bigint;
  validAfter: number;
  expiresAt: number;
  payer: `0x${string}`;
  metadataHash: `0x${string}`;
};

export class PaymentIntentSigner {
  readonly #config: AppConfig;

  public constructor(config: AppConfig) {
    this.#config = config;
  }

  public get address(): `0x${string}` | undefined {
    const privateKey = this.#config.PAYMENT_INTENT_SIGNER_PRIVATE_KEY;
    return privateKey
      ? (privateKeyToAccount(privateKey).address.toLowerCase() as `0x${string}`)
      : undefined;
  }

  public async sign(merchant: Merchant, message: UnsignedPaymentIntent) {
    const privateKey = this.#config.PAYMENT_INTENT_SIGNER_PRIVATE_KEY;
    const routerAddress = this.#config.PAYMENT_ROUTER_ADDRESS;
    if (!privateKey || !routerAddress) {
      throw new HttpError(
        503,
        'intent_signer_unavailable',
        'PaymentIntent signing is not configured',
      );
    }

    const account = privateKeyToAccount(privateKey);
    if (
      !merchant.delegatedSignerAddress ||
      merchant.delegatedSignerAddress !== account.address.toLowerCase()
    ) {
      throw new HttpError(
        409,
        'delegated_signer_mismatch',
        "The configured signer is not the merchant's verified delegated signer",
      );
    }

    const domain = {
      name: 'GiwaPay',
      version: '1',
      chainId: this.#config.GIWA_CHAIN_ID,
      verifyingContract: routerAddress,
    } as const;
    const signature = await account.signTypedData({
      domain,
      types: paymentIntentTypes,
      primaryType: 'PaymentIntent',
      message,
    });

    return {
      address: account.address.toLowerCase() as `0x${string}`,
      domain,
      types: paymentIntentTypes,
      signature,
    };
  }
}
