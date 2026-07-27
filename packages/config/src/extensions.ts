export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface PaymentQuoteRequest {
  readonly chainId: number;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly exactAmountOut: bigint;
  readonly payer: Address;
}

export interface PaymentQuote {
  readonly adapterId: string;
  readonly amountIn: bigint;
  readonly maxAmountIn: bigint;
  readonly expiresAt: Date;
  readonly opaqueAdapterData: Hex;
}

/**
 * Off-chain routing extension point. An implementation may quote only adapters
 * that are allowlisted by the on-chain AdapterRegistry.
 */
export interface PaymentMethodAdapter {
  readonly id: string;
  supports(request: PaymentQuoteRequest): Promise<boolean>;
  quoteExactOutput(request: PaymentQuoteRequest): Promise<PaymentQuote>;
}

export interface PartnerSession {
  readonly redirectUrl: URL;
  readonly expiresAt: Date;
  readonly externalReference: string;
}

export interface OnRampPartner {
  readonly id: string;
  createSession(input: {
    readonly wallet: Address;
    readonly destinationChainId: number;
    readonly destinationToken: Address;
  }): Promise<PartnerSession>;
}

export interface OffRampPartner {
  readonly id: string;
  createSession(input: {
    readonly merchant: Address;
    readonly sourceChainId: number;
    readonly sourceToken: Address;
    readonly amount: bigint;
  }): Promise<PartnerSession>;
}

export interface MerchantVerificationResult {
  readonly verified: boolean;
  readonly provider: 'giwa-dojang' | 'giwa-verified-address' | string;
  readonly checkedAt: Date;
  readonly expiresAt?: Date;
  readonly evidenceReference?: string;
}

/** Future extension only; no GIWA verification integration ships in the MVP. */
export interface MerchantVerificationProvider {
  verify(address: Address): Promise<MerchantVerificationResult>;
}

export interface X402PaymentRequest {
  readonly intentId: Hex;
  readonly chainId: number;
  readonly checkoutUrl: URL;
  readonly expiresAt: Date;
}

/** Future extension only; the MVP does not advertise x402 compatibility. */
export interface X402AgentPaymentProvider {
  createPaymentRequest(intentId: Hex): Promise<X402PaymentRequest>;
  verifyReceipt(intentId: Hex, transactionHash: Hex): Promise<boolean>;
}
