import { encodeFunctionData, encodePacked, keccak256, type Address, type Hex } from 'viem';

export const erc20ApprovalAbi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'approved', type: 'bool' }],
  },
] as const;

export const mockTokenFaucetAbi = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
] as const;

export const paymentRouterAbi = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'intent',
        type: 'tuple',
        components: [
          { name: 'intentId', type: 'bytes32' },
          { name: 'merchant', type: 'address' },
          { name: 'signer', type: 'address' },
          { name: 'settlementToken', type: 'address' },
          { name: 'settlementAmount', type: 'uint256' },
          { name: 'splitId', type: 'bytes32' },
          { name: 'splitHash', type: 'bytes32' },
          { name: 'platformFee', type: 'uint256' },
          { name: 'validAfter', type: 'uint48' },
          { name: 'expiresAt', type: 'uint48' },
          { name: 'payer', type: 'address' },
          { name: 'metadataHash', type: 'bytes32' },
        ],
      },
      { name: 'signature', type: 'bytes' },
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'maxAmountIn', type: 'uint256' },
          { name: 'adapter', type: 'address' },
          { name: 'adapterData', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'amountIn', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'merchant', type: 'address' },
      { name: 'intentId', type: 'bytes32' },
      { name: 'refundId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export const merchantRegistryAbi = [
  {
    type: 'function',
    name: 'registerMerchant',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'payoutAddress', type: 'address' },
      { name: 'delegatedSigner', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getMerchant',
    stateMutability: 'view',
    inputs: [{ name: 'merchant', type: 'address' }],
    outputs: [
      {
        name: 'record',
        type: 'tuple',
        components: [
          { name: 'admin', type: 'address' },
          { name: 'payoutAddress', type: 'address' },
          { name: 'delegatedSigner', type: 'address' },
          { name: 'refundOperator', type: 'address' },
          { name: 'active', type: 'bool' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'updatedAt', type: 'uint64' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'merchantForAdmin',
    stateMutability: 'view',
    inputs: [{ name: 'admin', type: 'address' }],
    outputs: [{ name: 'merchant', type: 'address' }],
  },
  {
    type: 'function',
    name: 'pendingAdmin',
    stateMutability: 'view',
    inputs: [{ name: 'merchant', type: 'address' }],
    outputs: [{ name: 'admin', type: 'address' }],
  },
  {
    type: 'function',
    name: 'proposeAdmin',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newAdmin', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelAdminTransfer',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'acceptAdmin',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'merchant', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'createSplitTemplate',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'splitId', type: 'bytes32' },
      { name: 'recipients', type: 'address[]' },
      { name: 'basisPoints', type: 'uint16[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'disableSplitTemplate',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'splitId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getSplitTemplate',
    stateMutability: 'view',
    inputs: [
      { name: 'merchant', type: 'address' },
      { name: 'splitId', type: 'bytes32' },
    ],
    outputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'basisPoints', type: 'uint16[]' },
      { name: 'enabled', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'splitTemplateCount',
    stateMutability: 'view',
    inputs: [{ name: 'merchant', type: 'address' }],
    outputs: [{ name: 'count', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'splitTemplateIdAt',
    stateMutability: 'view',
    inputs: [
      { name: 'merchant', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: 'splitId', type: 'bytes32' }],
  },
] as const;

export interface RouterPaymentIntent {
  intentId: Hex;
  merchant: Address;
  signer: Address;
  settlementToken: Address;
  settlementAmount: bigint;
  splitId: Hex;
  splitHash: Hex;
  platformFee: bigint;
  validAfter: number;
  expiresAt: number;
  payer: Address;
  metadataHash: Hex;
}

export interface RouterPaymentParams {
  tokenIn: Address;
  maxAmountIn: bigint;
  adapter: Address;
  adapterData: Hex;
}

export function encodeRouterPayment(args: {
  intent: RouterPaymentIntent;
  signature: Hex;
  params: RouterPaymentParams;
}): Hex {
  return encodeFunctionData({
    abi: paymentRouterAbi,
    functionName: 'pay',
    args: [args.intent, args.signature, args.params],
  });
}

export function encodeMerchantRegistration(args: {
  payoutAddress: Address;
  delegatedSigner: Address;
}): Hex {
  return encodeFunctionData({
    abi: merchantRegistryAbi,
    functionName: 'registerMerchant',
    args: [args.payoutAddress, args.delegatedSigner],
  });
}

export function encodeProposeMerchantAdmin(newAdmin: Address): Hex {
  return encodeFunctionData({
    abi: merchantRegistryAbi,
    functionName: 'proposeAdmin',
    args: [newAdmin],
  });
}

export function encodeAcceptMerchantAdmin(merchant: Address): Hex {
  return encodeFunctionData({
    abi: merchantRegistryAbi,
    functionName: 'acceptAdmin',
    args: [merchant],
  });
}

export function deriveSplitId(merchant: Address, stableLabel: string): Hex {
  const label = stableLabel.trim().toLowerCase();
  if (!label) throw new Error('A stable split label is required');
  return keccak256(encodePacked(['address', 'string'], [merchant, label]));
}

export function encodeCreateSplitTemplate(args: {
  splitId: Hex;
  recipients: readonly Address[];
  basisPoints: readonly number[];
}): Hex {
  if (
    args.recipients.length === 0 ||
    args.recipients.length > 8 ||
    args.recipients.length !== args.basisPoints.length
  ) {
    throw new Error('Split templates require 1 to 8 matching recipients');
  }
  if (args.basisPoints.reduce((sum, value) => sum + value, 0) !== 10_000) {
    throw new Error('Split basis points must total 10,000');
  }
  return encodeFunctionData({
    abi: merchantRegistryAbi,
    functionName: 'createSplitTemplate',
    args: [args.splitId, [...args.recipients], args.basisPoints.map((value) => value)],
  });
}

export function encodeDisableSplitTemplate(splitId: Hex): Hex {
  return encodeFunctionData({
    abi: merchantRegistryAbi,
    functionName: 'disableSplitTemplate',
    args: [splitId],
  });
}

export function encodeRefund(merchant: Address, intentId: Hex, refundId: Hex, amount: bigint): Hex {
  return encodeFunctionData({
    abi: paymentRouterAbi,
    functionName: 'refund',
    args: [merchant, intentId, refundId, amount],
  });
}
