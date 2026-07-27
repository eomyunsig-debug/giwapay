import {
  encodeAbiParameters,
  encodeEventTopics,
  zeroAddress,
  zeroHash,
  type Address,
  type TransactionReceipt,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { paymentRouterAbi } from './abi.js';
import { verifiedSettlementRecipients, type PaymentEventArguments } from './indexer-service.js';

const router = `0x${'11'.repeat(20)}` as Address;
const settlementToken = `0x${'22'.repeat(20)}` as Address;
const merchantA = `0x${'aa'.repeat(20)}` as Address;
const merchantB = `0x${'bb'.repeat(20)}` as Address;
const recipientA = `0x${'ca'.repeat(20)}` as Address;
const recipientB = `0x${'cb'.repeat(20)}` as Address;
const intentId = `0x${'33'.repeat(32)}` as const;

function distributionLog(
  merchant: Address,
  recipient: Address,
  token: Address,
  logIndex: number,
): TransactionReceipt['logs'][number] {
  return {
    address: router,
    topics: encodeEventTopics({
      abi: paymentRouterAbi,
      eventName: 'SettlementDistributed',
      args: { intentId, merchant, recipient },
    }),
    data: encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }, { type: 'uint16' }],
      [token, 100n, 10_000],
    ),
    blockHash: zeroHash,
    blockNumber: 1n,
    logIndex,
    transactionHash: zeroHash,
    transactionIndex: 0,
    removed: false,
  };
}

const payment: PaymentEventArguments = {
  intentId,
  merchant: merchantA,
  payer: recipientA,
  tokenIn: settlementToken,
  settlementToken,
  amountIn: 100n,
  merchantAmount: 100n,
  platformFee: 0n,
  splitId: zeroHash,
  adapter: zeroAddress,
};

describe('settlement receipt verification', () => {
  it('isolates distributions by merchant when one receipt reuses an intentId', () => {
    const recipients = verifiedSettlementRecipients(
      {
        logs: [
          distributionLog(merchantB, recipientB, settlementToken, 0),
          distributionLog(merchantA, recipientA, settlementToken, 1),
        ],
      },
      router,
      payment,
    );

    expect(recipients).toEqual([
      {
        address: recipientA,
        basisPoints: 10_000,
        amount: '100',
      },
    ]);
  });

  it('rejects a settlement-token mismatch inside the same merchant namespace', () => {
    expect(
      verifiedSettlementRecipients(
        {
          logs: [distributionLog(merchantA, recipientA, `0x${'44'.repeat(20)}`, 0)],
        },
        router,
        payment,
      ),
    ).toBeUndefined();
  });
});
