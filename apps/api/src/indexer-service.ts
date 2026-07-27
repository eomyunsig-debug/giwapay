import { randomUUID } from 'node:crypto';

import {
  and,
  chainBlocks,
  chainCursors,
  chainEvents,
  desc,
  eq,
  gt,
  inArray,
  lte,
  merchants,
  paymentIntents,
  refundRequests,
  type SettlementRecipientSnapshot,
  webhookDeliveries,
  webhookEndpoints,
  webhookEvents,
} from '@giwapay/db';
import type { Logger } from 'pino';
import { decodeEventLog, type Log, type TransactionReceipt } from 'viem';

import { paymentRouterAbi, zeroAddress } from './abi.js';
import { explorerTransactionUrl, normalizeAddress } from './chain.js';
import type { AppServices } from './types.js';

export type PaymentEventArguments = {
  intentId: `0x${string}`;
  merchant: `0x${string}`;
  payer: `0x${string}`;
  tokenIn: `0x${string}`;
  settlementToken: `0x${string}`;
  amountIn: bigint;
  merchantAmount: bigint;
  platformFee: bigint;
  splitId: `0x${string}`;
  adapter: `0x${string}`;
};

type DecodedPayment = {
  eventName: 'PaymentSucceeded';
  args: PaymentEventArguments;
};

type DecodedRefund = {
  eventName: 'Refunded';
  args: {
    intentId: `0x${string}`;
    refundId: `0x${string}`;
    merchant: `0x${string}`;
    payer: `0x${string}`;
    settlementToken: `0x${string}`;
    amount: bigint;
    totalRefunded: bigint;
    operator: `0x${string}`;
  };
};

type DecodedRouterEvent = DecodedPayment | DecodedRefund;

function decodeRouterEvent(log: Log): DecodedRouterEvent | undefined {
  try {
    const decoded = decodeEventLog({
      abi: paymentRouterAbi,
      data: log.data,
      topics: log.topics,
      strict: true,
    });
    if (decoded.eventName !== 'PaymentSucceeded' && decoded.eventName !== 'Refunded') {
      return undefined;
    }
    return decoded as DecodedRouterEvent;
  } catch {
    return undefined;
  }
}

function verifiedReceiptLog(receipt: TransactionReceipt, log: Log): boolean {
  if (
    receipt.status !== 'success' ||
    receipt.blockHash !== log.blockHash ||
    receipt.blockNumber !== log.blockNumber
  ) {
    return false;
  }
  return receipt.logs.some(
    (receiptLog) =>
      receiptLog.address.toLowerCase() === log.address.toLowerCase() &&
      receiptLog.logIndex === log.logIndex &&
      receiptLog.data === log.data &&
      receiptLog.topics.length === log.topics.length &&
      receiptLog.topics.every((topic, index) => topic === log.topics[index]),
  );
}

export function verifiedSettlementRecipients(
  receipt: Pick<TransactionReceipt, 'logs'>,
  router: `0x${string}`,
  payment: PaymentEventArguments,
): SettlementRecipientSnapshot[] | undefined {
  const recipients: SettlementRecipientSnapshot[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== router) continue;
    try {
      const decoded = decodeEventLog({
        abi: paymentRouterAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (
        decoded.eventName !== 'SettlementDistributed' ||
        decoded.args.intentId !== payment.intentId
      ) {
        continue;
      }
      if (normalizeAddress(decoded.args.merchant) !== normalizeAddress(payment.merchant)) {
        continue;
      }
      if (
        normalizeAddress(decoded.args.settlementToken) !== normalizeAddress(payment.settlementToken)
      ) {
        return undefined;
      }
      recipients.push({
        address: normalizeAddress(decoded.args.recipient),
        basisPoints: decoded.args.basisPoints,
        amount: decoded.args.amount.toString(),
      });
    } catch {
      // Other router events in the receipt are not distribution evidence.
    }
  }
  if (recipients.length === 0 || recipients.length > 8) return undefined;
  if (new Set(recipients.map(({ address }) => address)).size !== recipients.length) {
    return undefined;
  }
  if (recipients.reduce((sum, recipient) => sum + recipient.basisPoints, 0) !== 10_000) {
    return undefined;
  }
  let remaining = payment.merchantAmount;
  for (const [index, recipient] of recipients.entries()) {
    const expected =
      index === recipients.length - 1
        ? remaining
        : (payment.merchantAmount * BigInt(recipient.basisPoints)) / 10_000n;
    if (recipient.basisPoints <= 0 || BigInt(recipient.amount) !== expected) return undefined;
    remaining -= expected;
  }
  return remaining === 0n ? recipients : undefined;
}

function matchesSignedSettlementTerms(
  actual: readonly SettlementRecipientSnapshot[],
  expected: readonly { address: `0x${string}`; basisPoints: number }[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (recipient, index) =>
        recipient.address === expected[index]?.address &&
        recipient.basisPoints === expected[index]?.basisPoints,
    )
  );
}

async function enqueueWebhook(
  tx: Parameters<Parameters<AppServices['db']['transaction']>[0]>[0],
  merchantId: string,
  eventType: string,
  aggregateId: string,
  data: Record<string, unknown>,
) {
  const eventId = randomUUID();
  const createdAt = new Date();
  const [event] = await tx
    .insert(webhookEvents)
    .values({
      id: eventId,
      merchantId,
      eventType,
      aggregateId,
      payload: {
        id: eventId,
        type: eventType,
        createdAt: createdAt.toISOString(),
        data,
      },
      createdAt,
    })
    .onConflictDoNothing()
    .returning();
  if (!event) return;
  const endpoints = await tx
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.merchantId, merchantId), eq(webhookEndpoints.enabled, true)));
  if (endpoints.length > 0) {
    await tx.insert(webhookDeliveries).values(
      endpoints.map((endpoint) => ({
        eventId: event.id,
        endpointId: endpoint.id,
      })),
    );
  }
}

async function invalidatePendingWebhookDeliveries(
  tx: Parameters<Parameters<AppServices['db']['transaction']>[0]>[0],
  eventType: string,
  aggregateIds: readonly string[],
) {
  if (aggregateIds.length === 0) return;
  const events = await tx
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(
      and(
        eq(webhookEvents.eventType, eventType),
        inArray(webhookEvents.aggregateId, [...aggregateIds]),
      ),
    );
  if (events.length === 0) return;
  await tx
    .update(webhookDeliveries)
    .set({
      status: 'dead_letter',
      leaseExpiresAt: null,
      lastError: 'invalidated_by_chain_reorganization',
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(
          webhookDeliveries.eventId,
          events.map((event) => event.id),
        ),
        inArray(webhookDeliveries.status, ['pending', 'processing', 'retry']),
      ),
    );
}

export class ChainIndexer {
  readonly #services: AppServices;
  readonly #logger: Logger;
  readonly #router: `0x${string}`;

  public constructor(services: AppServices, logger: Logger) {
    if (!services.config.PAYMENT_ROUTER_ADDRESS) {
      throw new Error('PAYMENT_ROUTER_ADDRESS is required for the indexer');
    }
    this.#services = services;
    this.#logger = logger;
    this.#router = services.config.PAYMENT_ROUTER_ADDRESS;
  }

  public async next(): Promise<boolean> {
    const cursor = await this.#getCursor();
    const canonical = await this.#assertCanonicalCursor(cursor);
    if (!canonical) {
      // Rollback persisted a replacement cursor. Continuing with the stale
      // in-memory value could skip the replacement block range permanently.
      return true;
    }
    const latestBlock = await this.#services.chainClient.getBlockNumber();
    const confirmations = BigInt(this.#services.config.CHAIN_CONFIRMATIONS);
    if (latestBlock < confirmations) return false;
    const finalizedBlock = latestBlock - confirmations;
    if (cursor.nextBlockNumber > finalizedBlock) return false;
    const toBlock =
      cursor.nextBlockNumber + BigInt(this.#services.config.INDEXER_BATCH_SIZE - 1) > finalizedBlock
        ? finalizedBlock
        : cursor.nextBlockNumber + BigInt(this.#services.config.INDEXER_BATCH_SIZE - 1);
    const rangeAnchor = await this.#services.chainClient.getBlock({
      blockNumber: toBlock,
    });
    const logs = await this.#services.chainClient.getLogs({
      address: this.#router,
      fromBlock: cursor.nextBlockNumber,
      toBlock,
    });
    const verified: {
      log: (typeof logs)[number];
      decoded: DecodedRouterEvent;
      receipt: TransactionReceipt;
    }[] = [];
    for (const log of logs) {
      const decoded = decodeRouterEvent(log);
      if (!decoded || log.logIndex === null) continue;
      const receipt = await this.#services.chainClient.getTransactionReceipt({
        hash: log.transactionHash,
      });
      if (!verifiedReceiptLog(receipt, log)) {
        this.#logger.error(
          {
            transactionHash: log.transactionHash,
            logIndex: log.logIndex,
          },
          'Rejected unverifiable router log',
        );
        continue;
      }
      verified.push({ log, decoded, receipt });
    }
    const stableAnchor = await this.#services.chainClient.getBlock({
      blockNumber: toBlock,
    });
    if (stableAnchor.hash !== rangeAnchor.hash) {
      this.#logger.warn(
        { blockNumber: toBlock.toString() },
        'Chain range changed while logs were being verified; retrying',
      );
      return false;
    }
    for (const item of verified) {
      if (item.decoded.eventName === 'PaymentSucceeded') {
        await this.#applyPayment(item.log, item.decoded, item.receipt);
      } else {
        await this.#applyRefund(item.log, item.decoded, item.receipt);
      }
    }
    await this.#services.db.transaction(async (tx) => {
      await tx
        .insert(chainBlocks)
        .values({
          chainId: this.#services.config.GIWA_CHAIN_ID,
          blockNumber: toBlock,
          blockHash: rangeAnchor.hash,
          parentHash: rangeAnchor.parentHash,
        })
        .onConflictDoUpdate({
          target: [chainBlocks.chainId, chainBlocks.blockNumber],
          set: {
            blockHash: rangeAnchor.hash,
            parentHash: rangeAnchor.parentHash,
            processedAt: new Date(),
          },
        });
      await tx
        .update(chainCursors)
        .set({
          nextBlockNumber: toBlock + 1n,
          lastBlockHash: rangeAnchor.hash,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chainCursors.chainId, this.#services.config.GIWA_CHAIN_ID),
            eq(chainCursors.contractAddress, this.#router),
          ),
        );
    });
    this.#logger.info(
      {
        fromBlock: cursor.nextBlockNumber.toString(),
        toBlock: toBlock.toString(),
        logCount: logs.length,
      },
      'Indexed confirmed block range',
    );
    return true;
  }

  async #getCursor() {
    const [cursor] = await this.#services.db
      .insert(chainCursors)
      .values({
        chainId: this.#services.config.GIWA_CHAIN_ID,
        contractAddress: this.#router,
        nextBlockNumber: this.#services.config.CHAIN_START_BLOCK,
      })
      .onConflictDoNothing()
      .returning();
    if (cursor) return cursor;
    const [existing] = await this.#services.db
      .select()
      .from(chainCursors)
      .where(
        and(
          eq(chainCursors.chainId, this.#services.config.GIWA_CHAIN_ID),
          eq(chainCursors.contractAddress, this.#router),
        ),
      )
      .limit(1);
    if (!existing) throw new Error('Unable to initialize chain cursor');
    return existing;
  }

  async #assertCanonicalCursor(cursor: typeof chainCursors.$inferSelect): Promise<boolean> {
    if (
      !cursor.lastBlockHash ||
      cursor.nextBlockNumber <= this.#services.config.CHAIN_START_BLOCK
    ) {
      return true;
    }
    const previousBlock = cursor.nextBlockNumber - 1n;
    const live = await this.#services.chainClient.getBlock({
      blockNumber: previousBlock,
    });
    if (live.hash === cursor.lastBlockHash) return true;
    this.#logger.warn(
      {
        previousBlock: previousBlock.toString(),
        storedHash: cursor.lastBlockHash,
        liveHash: live.hash,
      },
      'Confirmed-chain reorganization detected',
    );
    await this.#rollbackToCommonAncestor(previousBlock);
    return false;
  }

  async #rollbackToCommonAncestor(previousBlock: bigint) {
    const candidates = await this.#services.db
      .select()
      .from(chainBlocks)
      .where(
        and(
          eq(chainBlocks.chainId, this.#services.config.GIWA_CHAIN_ID),
          lte(chainBlocks.blockNumber, previousBlock),
          gt(
            chainBlocks.blockNumber,
            previousBlock - BigInt(this.#services.config.REORG_LOOKBACK_BLOCKS),
          ),
        ),
      )
      .orderBy(desc(chainBlocks.blockNumber));
    let ancestor: (typeof candidates)[number] | undefined;
    for (const candidate of candidates) {
      const live = await this.#services.chainClient.getBlock({
        blockNumber: candidate.blockNumber,
      });
      if (live.hash === candidate.blockHash) {
        ancestor = candidate;
        break;
      }
    }
    if (!ancestor) {
      throw new Error(
        'No common chain ancestor found within REORG_LOOKBACK_BLOCKS; manual intervention required',
      );
    }
    const affected = await this.#services.db
      .select()
      .from(chainEvents)
      .where(
        and(
          eq(chainEvents.chainId, this.#services.config.GIWA_CHAIN_ID),
          gt(chainEvents.blockNumber, ancestor.blockNumber),
        ),
      );
    await this.#services.db.transaction(async (tx) => {
      await tx
        .delete(chainEvents)
        .where(
          and(
            eq(chainEvents.chainId, this.#services.config.GIWA_CHAIN_ID),
            gt(chainEvents.blockNumber, ancestor.blockNumber),
          ),
        );
      await tx
        .delete(chainBlocks)
        .where(
          and(
            eq(chainBlocks.chainId, this.#services.config.GIWA_CHAIN_ID),
            gt(chainBlocks.blockNumber, ancestor.blockNumber),
          ),
        );
      await tx
        .update(chainCursors)
        .set({
          nextBlockNumber: ancestor.blockNumber + 1n,
          lastBlockHash: ancestor.blockHash,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chainCursors.chainId, this.#services.config.GIWA_CHAIN_ID),
            eq(chainCursors.contractAddress, this.#router),
          ),
        );

      const affectedNamespaces = new Map<
        string,
        { merchantAddress: string; aggregateId: string }
      >();
      for (const event of affected) {
        affectedNamespaces.set(`${event.merchantAddress}:${event.aggregateId}`, {
          merchantAddress: event.merchantAddress,
          aggregateId: event.aggregateId,
        });
      }
      for (const { merchantAddress, aggregateId: aggregate } of affectedNamespaces.values()) {
        const affectedAggregateEvents = affected.filter(
          (event) => event.merchantAddress === merchantAddress && event.aggregateId === aggregate,
        );
        const paymentEventReorged = affectedAggregateEvents.some(
          (event) => event.eventName === 'PaymentSucceeded',
        );
        const [row] = await tx
          .select({ intent: paymentIntents })
          .from(paymentIntents)
          .innerJoin(merchants, eq(merchants.id, paymentIntents.merchantId))
          .where(
            and(
              eq(paymentIntents.paymentId, aggregate),
              eq(merchants.adminAddress, merchantAddress),
            ),
          )
          .limit(1);
        const intent = row?.intent;
        if (!intent) continue;
        const [survivingPayment] = await tx
          .select()
          .from(chainEvents)
          .where(
            and(
              eq(chainEvents.aggregateId, aggregate),
              eq(chainEvents.merchantAddress, merchantAddress),
              eq(chainEvents.chainId, this.#services.config.GIWA_CHAIN_ID),
              eq(chainEvents.contractAddress, this.#router),
              eq(chainEvents.eventName, 'PaymentSucceeded'),
            ),
          )
          .limit(1);
        const [latestRefund] = await tx
          .select()
          .from(chainEvents)
          .where(
            and(
              eq(chainEvents.aggregateId, aggregate),
              eq(chainEvents.merchantAddress, merchantAddress),
              eq(chainEvents.chainId, this.#services.config.GIWA_CHAIN_ID),
              eq(chainEvents.contractAddress, this.#router),
              eq(chainEvents.eventName, 'Refunded'),
            ),
          )
          .orderBy(desc(chainEvents.blockNumber), desc(chainEvents.logIndex))
          .limit(1);
        const refunded = latestRefund?.payload.totalRefunded ?? '0';
        const status = !survivingPayment
          ? 'created'
          : BigInt(refunded) === 0n
            ? 'succeeded'
            : BigInt(refunded) >= BigInt(intent.settlementAmount)
              ? 'refunded'
              : 'partially_refunded';
        await tx
          .update(paymentIntents)
          .set({
            status,
            refundedAmount: refunded,
            ...(!survivingPayment
              ? {
                  payerAddress: null,
                  inputToken: null,
                  inputAmount: null,
                  platformFeeAmount: null,
                  paymentTransactionHash: null,
                  paymentBlockNumber: null,
                  paymentBlockHash: null,
                  paymentLogIndex: null,
                  chainVerifiedAt: null,
                  settlementRecipients: null,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(paymentIntents.id, intent.id));
        const rolledBackRefunds = await tx
          .select({
            id: refundRequests.id,
            refundId: refundRequests.refundId,
            transactionHash: refundRequests.transactionHash,
            blockHash: refundRequests.blockHash,
          })
          .from(refundRequests)
          .where(
            and(
              eq(refundRequests.paymentIntentId, intent.id),
              gt(refundRequests.blockNumber, ancestor.blockNumber),
            ),
          );
        await tx
          .update(refundRequests)
          .set({
            // Calldata for a refund that reached a non-canonical block remains
            // executable if the transaction is re-broadcast or reappears.
            // Keep it pending and retain its transaction identity so the API
            // cannot safely open a replacement refund slot.
            status: 'submitted',
            blockNumber: null,
            blockHash: null,
            logIndex: null,
            chainVerifiedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(refundRequests.paymentIntentId, intent.id),
              gt(refundRequests.blockNumber, ancestor.blockNumber),
            ),
          );

        if (paymentEventReorged) {
          await invalidatePendingWebhookDeliveries(tx, 'payment.succeeded', [intent.id]);
          await enqueueWebhook(tx, intent.merchantId, 'payment.reorged', intent.id, {
            paymentIntentId: intent.id,
            paymentId: intent.paymentId,
            status,
            invalidatedTransactionHash: intent.paymentTransactionHash,
            invalidatedBlockHash: intent.paymentBlockHash,
            rollbackBlock: ancestor.blockNumber.toString(),
          });
        }
        if (rolledBackRefunds.length > 0) {
          await invalidatePendingWebhookDeliveries(
            tx,
            'refund.succeeded',
            rolledBackRefunds.map((refund) => refund.id),
          );
          for (const refund of rolledBackRefunds) {
            await enqueueWebhook(tx, intent.merchantId, 'refund.reorged', refund.id, {
              refundId: refund.id,
              chainRefundId: refund.refundId,
              paymentIntentId: intent.id,
              paymentId: intent.paymentId,
              status: 'submitted',
              invalidatedTransactionHash: refund.transactionHash,
              invalidatedBlockHash: refund.blockHash,
              rollbackBlock: ancestor.blockNumber.toString(),
            });
          }
        }
      }
    });
    this.#logger.warn(
      {
        ancestorBlock: ancestor.blockNumber.toString(),
        affectedEvents: affected.length,
      },
      'Rolled back non-canonical projections',
    );
  }

  async #applyPayment(
    log: Log<bigint, number, false>,
    decoded: DecodedPayment,
    receipt: TransactionReceipt,
  ) {
    const args = decoded.args;
    const [row] = await this.#services.db
      .select({ intent: paymentIntents, merchant: merchants })
      .from(paymentIntents)
      .innerJoin(merchants, eq(merchants.id, paymentIntents.merchantId))
      .where(
        and(
          eq(paymentIntents.paymentId, args.intentId),
          eq(merchants.adminAddress, normalizeAddress(args.merchant)),
        ),
      )
      .limit(1);
    if (!row) {
      this.#logger.warn(
        { intentId: args.intentId },
        'Ignoring PaymentSucceeded for unknown PaymentIntent',
      );
      return;
    }
    const { intent, merchant } = row;
    const valid =
      merchant.adminAddress === normalizeAddress(args.merchant) &&
      intent.settlementToken === normalizeAddress(args.settlementToken) &&
      BigInt(intent.settlementAmount) === args.merchantAmount &&
      BigInt(intent.platformFee) === args.platformFee &&
      intent.splitId === args.splitId.toLowerCase() &&
      (intent.payerRestriction === zeroAddress ||
        intent.payerRestriction === normalizeAddress(args.payer));
    if (!valid) {
      this.#logger.error(
        { intentId: args.intentId, transactionHash: log.transactionHash },
        'Rejected PaymentSucceeded that conflicts with stored signed intent',
      );
      return;
    }
    const settlementRecipients = verifiedSettlementRecipients(receipt, this.#router, args);
    if (
      !settlementRecipients ||
      !matchesSignedSettlementTerms(settlementRecipients, intent.expectedSettlementRecipients)
    ) {
      this.#logger.error(
        { intentId: args.intentId, transactionHash: log.transactionHash },
        'Rejected PaymentSucceeded without the signed canonical settlement distribution',
      );
      return;
    }
    if (log.logIndex === null || !log.blockHash) return;
    const payload = {
      intentId: args.intentId,
      merchant: normalizeAddress(args.merchant),
      payer: normalizeAddress(args.payer),
      tokenIn: normalizeAddress(args.tokenIn),
      settlementToken: normalizeAddress(args.settlementToken),
      amountIn: args.amountIn.toString(),
      merchantAmount: args.merchantAmount.toString(),
      platformFee: args.platformFee.toString(),
      splitId: args.splitId,
      adapter: normalizeAddress(args.adapter),
    };
    await this.#services.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(chainEvents)
        .values({
          chainId: this.#services.config.GIWA_CHAIN_ID,
          contractAddress: this.#router,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash!,
          eventName: 'PaymentSucceeded',
          merchantAddress: normalizeAddress(args.merchant),
          aggregateId: args.intentId,
          payload,
        })
        .onConflictDoNothing()
        .returning({ id: chainEvents.id });
      if (inserted.length === 0) return;
      await tx
        .update(paymentIntents)
        .set({
          status: 'succeeded',
          payerAddress: normalizeAddress(args.payer),
          inputToken: normalizeAddress(args.tokenIn),
          inputAmount: args.amountIn.toString(),
          platformFeeAmount: args.platformFee.toString(),
          paymentTransactionHash: log.transactionHash,
          paymentBlockNumber: log.blockNumber,
          paymentBlockHash: log.blockHash!,
          paymentLogIndex: log.logIndex,
          chainVerifiedAt: new Date(),
          settlementRecipients,
          updatedAt: new Date(),
        })
        .where(eq(paymentIntents.id, intent.id));
      await enqueueWebhook(tx, intent.merchantId, 'payment.succeeded', intent.id, {
        paymentIntentId: intent.id,
        paymentId: intent.paymentId,
        status: 'succeeded',
        transactionHash: log.transactionHash,
        blockHash: log.blockHash,
        explorerUrl: explorerTransactionUrl(
          log.transactionHash,
          this.#services.config.chainExplorerUrl,
        ),
        blockNumber: log.blockNumber.toString(),
        logIndex: log.logIndex,
        payer: payload.payer,
        tokenIn: payload.tokenIn,
        inputAmount: payload.amountIn,
        settlementToken: payload.settlementToken,
        settlementAmount: payload.merchantAmount,
        platformFee: payload.platformFee,
        settlementRecipients,
      });
    });
    this.#logger.info(
      {
        intentId: args.intentId,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
      },
      'Verified PaymentSucceeded',
    );
  }

  async #applyRefund(
    log: Log<bigint, number, false>,
    decoded: DecodedRefund,
    receipt: TransactionReceipt,
  ) {
    const args = decoded.args;
    const [row] = await this.#services.db
      .select({ intent: paymentIntents, merchant: merchants })
      .from(paymentIntents)
      .innerJoin(merchants, eq(merchants.id, paymentIntents.merchantId))
      .where(
        and(
          eq(paymentIntents.paymentId, args.intentId),
          eq(merchants.adminAddress, normalizeAddress(args.merchant)),
        ),
      )
      .limit(1);
    if (!row || log.logIndex === null || !log.blockHash) return;
    const { intent, merchant } = row;
    const valid =
      merchant.adminAddress === normalizeAddress(args.merchant) &&
      intent.settlementToken === normalizeAddress(args.settlementToken) &&
      intent.payerAddress === normalizeAddress(args.payer) &&
      args.amount > 0n &&
      args.totalRefunded <= BigInt(intent.settlementAmount) &&
      args.totalRefunded === BigInt(intent.refundedAmount) + args.amount;
    if (!valid) {
      this.#logger.error(
        { intentId: args.intentId, transactionHash: log.transactionHash },
        'Rejected Refunded event that conflicts with verified payment state',
      );
      return;
    }
    const payload = {
      intentId: args.intentId,
      refundId: args.refundId,
      merchant: normalizeAddress(args.merchant),
      payer: normalizeAddress(args.payer),
      settlementToken: normalizeAddress(args.settlementToken),
      amount: args.amount.toString(),
      totalRefunded: args.totalRefunded.toString(),
      operator: normalizeAddress(args.operator),
    };
    await this.#services.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(chainEvents)
        .values({
          chainId: this.#services.config.GIWA_CHAIN_ID,
          contractAddress: this.#router,
          transactionHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash!,
          eventName: 'Refunded',
          merchantAddress: normalizeAddress(args.merchant),
          aggregateId: args.intentId,
          payload,
        })
        .onConflictDoNothing()
        .returning({ id: chainEvents.id });
      if (inserted.length === 0) return;
      const [existing] = await tx
        .select()
        .from(refundRequests)
        .where(
          and(
            eq(refundRequests.paymentIntentId, intent.id),
            eq(refundRequests.refundId, args.refundId),
          ),
        )
        .orderBy(refundRequests.createdAt)
        .limit(1);
      const refund =
        existing ??
        (
          await tx
            .insert(refundRequests)
            .values({
              refundId: args.refundId,
              paymentIntentId: intent.id,
              merchantId: intent.merchantId,
              idempotencyKey: `chain:${args.intentId}:${args.refundId}`,
              amount: args.amount.toString(),
              status: 'succeeded',
            })
            .onConflictDoNothing()
            .returning()
        )[0];
      if (!refund) throw new Error('Unable to project refund event');
      await tx
        .update(refundRequests)
        .set({
          status: 'succeeded',
          amount: args.amount.toString(),
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash!,
          logIndex: log.logIndex,
          chainVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(refundRequests.id, refund.id));
      const fullyRefunded = args.totalRefunded === BigInt(intent.settlementAmount);
      await tx
        .update(paymentIntents)
        .set({
          status: fullyRefunded ? 'refunded' : 'partially_refunded',
          refundedAmount: args.totalRefunded.toString(),
          updatedAt: new Date(),
        })
        .where(eq(paymentIntents.id, intent.id));
      await enqueueWebhook(tx, intent.merchantId, 'refund.succeeded', refund.id, {
        refundId: refund.id,
        paymentIntentId: intent.id,
        paymentId: intent.paymentId,
        status: 'succeeded',
        amount: args.amount.toString(),
        totalRefunded: args.totalRefunded.toString(),
        transactionHash: log.transactionHash,
        blockHash: log.blockHash,
        explorerUrl: explorerTransactionUrl(
          log.transactionHash,
          this.#services.config.chainExplorerUrl,
        ),
        blockNumber: log.blockNumber.toString(),
        logIndex: log.logIndex,
      });
    });
    this.#logger.info(
      {
        intentId: args.intentId,
        transactionHash: receipt.transactionHash,
        amount: args.amount.toString(),
      },
      'Verified Refunded',
    );
  }
}
