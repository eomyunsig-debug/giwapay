import { parseAbi, parseAbiItem } from 'viem';

export const zeroAddress = '0x0000000000000000000000000000000000000000' as const;
export const zeroBytes32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

export const paymentRouterAbi = parseAbi([
  'function platformFeeBps() view returns (uint16)',
  'function merchantRegistry() view returns (address)',
  'function adapterRegistry() view returns (address)',
  'function pay((bytes32 intentId,address merchant,address signer,address settlementToken,uint256 settlementAmount,bytes32 splitId,bytes32 splitHash,uint256 platformFee,uint48 validAfter,uint48 expiresAt,address payer,bytes32 metadataHash) intent, bytes signature, (address tokenIn,uint256 maxAmountIn,address adapter,bytes adapterData) params) returns (uint256 amountIn)',
  'function refund(address merchant,bytes32 intentId,bytes32 refundId,uint256 amount)',
  'event PaymentSucceeded(bytes32 indexed intentId,address indexed merchant,address indexed payer,address tokenIn,address settlementToken,uint256 amountIn,uint256 merchantAmount,uint256 platformFee,bytes32 splitId,address adapter)',
  'event SettlementDistributed(bytes32 indexed intentId,address indexed merchant,address indexed recipient,address settlementToken,uint256 amount,uint16 basisPoints)',
  'event Refunded(bytes32 indexed intentId,bytes32 indexed refundId,address indexed merchant,address payer,address settlementToken,uint256 amount,uint256 totalRefunded,address operator)',
]);

export const paymentSucceededEvent = parseAbiItem(
  'event PaymentSucceeded(bytes32 indexed intentId,address indexed merchant,address indexed payer,address tokenIn,address settlementToken,uint256 amountIn,uint256 merchantAmount,uint256 platformFee,bytes32 splitId,address adapter)',
);

export const settlementDistributedEvent = parseAbiItem(
  'event SettlementDistributed(bytes32 indexed intentId,address indexed merchant,address indexed recipient,address settlementToken,uint256 amount,uint16 basisPoints)',
);

export const refundedEvent = parseAbiItem(
  'event Refunded(bytes32 indexed intentId,bytes32 indexed refundId,address indexed merchant,address payer,address settlementToken,uint256 amount,uint256 totalRefunded,address operator)',
);

export const exactOutputAdapterAbi = parseAbi([
  'function quoteExactOutput(address tokenIn,address tokenOut,uint256 exactAmountOut,bytes data) view returns (uint256 amountIn)',
]);

export const adapterRegistryAbi = [
  {
    type: 'function',
    name: 'validateAdapter',
    stateMutability: 'view',
    inputs: [
      { name: 'adapter', type: 'address' },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'maxAmountIn', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getAdapter',
    stateMutability: 'view',
    inputs: [{ name: 'adapter', type: 'address' }],
    outputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'enabled', type: 'bool' },
          { name: 'testOnly', type: 'bool' },
          { name: 'runtimeCodeHash', type: 'bytes32' },
          { name: 'identifier', type: 'string' },
        ],
      },
    ],
  },
] as const;

export const erc20Abi = parseAbi([
  'function approve(address spender,uint256 amount) returns (bool)',
]);

export const erc20MetadataAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);

export const merchantRegistryAbi = [
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
    name: 'getMerchant',
    stateMutability: 'view',
    inputs: [{ name: 'merchant', type: 'address' }],
    outputs: [
      {
        name: 'config',
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
] as const;

export const paymentIntentTypes = {
  PaymentIntent: [
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
} as const;
