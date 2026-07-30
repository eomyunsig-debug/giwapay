import type { Page } from '@playwright/test';
import type { Address, Hex } from 'viem';

export const ANVIL_WALLET_RPC_URL = 'http://127.0.0.1:8545' as const;
export const ANVIL_WALLET_CHAIN_ID = 91_342 as const;
export const ANVIL_WALLET_CHAIN_ID_HEX = '0x164ce' as const;

export const ANVIL_WALLET_PROVIDER_INFO = {
  uuid: '91342000-0000-4000-8000-000000000001',
  name: 'GiwaPay Anvil test wallet',
  icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2296%22 height=%2296%22 viewBox=%220 0 96 96%22%3E%3Crect width=%2296%22 height=%2296%22 rx=%2224%22 fill=%22%23111627%22/%3E%3Cpath d=%22M24 30h48v12H38v12h28v12H38v12H24z%22 fill=%22%234ee7b7%22/%3E%3C/svg%3E',
  rdns: 'io.giwapay.test.anvil',
} as const;

const RPC_BINDING_NAME = '__giwapayAnvilRpc91342' as const;
const TRANSACTION_RECORDS_NAME = '__giwapayAnvilWalletTransactions' as const;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ERC20_APPROVE_SELECTOR = '0x095ea7b3';
const PAYMENT_ROUTER_PAY_SELECTOR = '0x213cee43';

interface InstallAnvilWalletOptions {
  accountIndex?: number;
  /**
   * The disposable payer can submit transactions only to these two contracts:
   * the selected mock token and the deployed PaymentRouter.
   */
  allowedTransactionTargets: readonly Address[];
}

export interface InstalledAnvilWallet {
  readonly account: Address;
  readonly chainId: typeof ANVIL_WALLET_CHAIN_ID;
  readonly chainIdHex: typeof ANVIL_WALLET_CHAIN_ID_HEX;
  readonly rpcUrl: typeof ANVIL_WALLET_RPC_URL;
  readonly providerInfo: typeof ANVIL_WALLET_PROVIDER_INFO;
}

export interface AnvilWalletTransaction {
  readonly to: Address;
  readonly hash: Hex;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

type RpcBridgeResponse = { ok: true; hash: Hex; to: Address } | { ok: false; error: JsonRpcError };

let jsonRpcRequestId = 0;

const errorWithCode = (message: string, code: number, data?: unknown): Error => {
  const error = new Error(message);
  Object.assign(error, { code, ...(data === undefined ? {} : { data }) });
  return error;
};

const serializeRpcError = (error: unknown): JsonRpcError => {
  const record =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined;
  return {
    code: typeof record?.code === 'number' && Number.isInteger(record.code) ? record.code : -32_000,
    message:
      error instanceof Error && error.message ? error.message : 'Local Anvil RPC request failed',
    ...(record && 'data' in record ? { data: record.data } : {}),
  };
};

const normalizeAddress = (value: unknown): Address | undefined =>
  typeof value === 'string' && ADDRESS_PATTERN.test(value)
    ? (value.toLowerCase() as Address)
    : undefined;

const normalizeChainId = (value: unknown): bigint | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value)) {
    return undefined;
  }
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
};

const callAnvilRpc = async (method: string, params: readonly unknown[] = []): Promise<unknown> => {
  const url = new URL(ANVIL_WALLET_RPC_URL);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '8545' ||
    url.username ||
    url.password
  ) {
    throw new Error('Disposable wallet RPC must remain pinned to 127.0.0.1:8545');
  }

  jsonRpcRequestId += 1;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: jsonRpcRequestId,
      method,
      params,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw errorWithCode(`Local Anvil RPC returned HTTP ${response.status}`, -32_000);
  }

  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null) {
    throw errorWithCode('Local Anvil RPC returned an invalid JSON-RPC response', -32_000);
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'object' && record.error !== null) {
    const rpcError = record.error as Record<string, unknown>;
    throw errorWithCode(
      typeof rpcError.message === 'string' ? rpcError.message : 'Local Anvil RPC request failed',
      typeof rpcError.code === 'number' ? rpcError.code : -32_000,
      rpcError.data,
    );
  }
  return record.result;
};

const checkedUnlockedAccounts = async (): Promise<Address[]> => {
  const chainId = await callAnvilRpc('eth_chainId');
  if (normalizeChainId(chainId) !== BigInt(ANVIL_WALLET_CHAIN_ID)) {
    throw errorWithCode(
      `Refusing wallet access: local Anvil must use chain ID ${ANVIL_WALLET_CHAIN_ID}`,
      4_902,
    );
  }
  const accounts = await callAnvilRpc('eth_accounts');
  if (!Array.isArray(accounts)) {
    throw errorWithCode('Local Anvil did not expose unlocked accounts', 4_100);
  }
  const normalized = accounts.map(normalizeAddress);
  if (normalized.some((account) => !account)) {
    throw errorWithCode('Local Anvil exposed an invalid unlocked account', 4_100);
  }
  return normalized as Address[];
};

/**
 * Installs a CI-only EIP-1193/EIP-6963 payer backed by one unlocked Anvil
 * account. It contains no private key and refuses signing plus every
 * transaction target outside the exact mock-token/PaymentRouter allowlist.
 */
export async function installAnvilEip1193Wallet(
  page: Page,
  options: InstallAnvilWalletOptions,
): Promise<InstalledAnvilWallet> {
  const accountIndex = options.accountIndex ?? 0;
  if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) {
    throw new Error('Anvil wallet accountIndex must be a non-negative safe integer');
  }
  const allowedTargets = options.allowedTransactionTargets.map(normalizeAddress);
  if (
    allowedTargets.length !== 2 ||
    allowedTargets.some((target) => !target) ||
    new Set(allowedTargets).size !== 2
  ) {
    throw new Error('Disposable wallet requires two distinct valid transaction targets');
  }
  const [mockTokenTarget, paymentRouterTarget] = allowedTargets as Address[];
  const targetAllowlist = new Set([mockTokenTarget, paymentRouterTarget]);

  const accounts = await checkedUnlockedAccounts();
  const account = accounts[accountIndex];
  if (!account) {
    throw new Error(
      `Anvil wallet accountIndex ${accountIndex} is unavailable (${accounts.length} accounts)`,
    );
  }

  await page.exposeFunction(
    RPC_BINDING_NAME,
    async (request: { method?: unknown; params?: unknown }): Promise<RpcBridgeResponse> => {
      try {
        if (request?.method !== 'eth_sendTransaction') {
          throw errorWithCode('Disposable payer permits transaction submission only', 4_200);
        }
        if (!Array.isArray(request.params) || request.params.length !== 1) {
          throw errorWithCode('eth_sendTransaction requires one transaction object', -32_602);
        }
        const transaction = request.params[0];
        if (typeof transaction !== 'object' || transaction === null) {
          throw errorWithCode('eth_sendTransaction requires a transaction object', -32_602);
        }
        const transactionRecord = transaction as Record<string, unknown>;
        if (normalizeAddress(transactionRecord.from) !== account) {
          throw errorWithCode('Disposable wallet may send only from its selected account', 4_100);
        }
        const to = normalizeAddress(transactionRecord.to);
        if (!to || !targetAllowlist.has(to)) {
          throw errorWithCode('Disposable wallet rejected a non-allowlisted target', 4_100);
        }
        const data =
          typeof transactionRecord.data === 'string' ? transactionRecord.data.toLowerCase() : '';
        if (!/^0x[0-9a-f]*$/.test(data)) {
          throw errorWithCode('Disposable wallet requires canonical transaction calldata', 4_100);
        }
        if (to === mockTokenTarget) {
          const spender =
            data.startsWith(ERC20_APPROVE_SELECTOR) && data.length === 138
              ? normalizeAddress(`0x${data.slice(34, 74)}`)
              : undefined;
          const amount = spender ? BigInt(`0x${data.slice(74, 138)}`) : 0n;
          if (spender !== paymentRouterTarget || amount <= 0n) {
            throw errorWithCode(
              'Disposable wallet permits only a positive token approval to PaymentRouter',
              4_100,
            );
          }
        } else if (!data.startsWith(PAYMENT_ROUTER_PAY_SELECTOR)) {
          throw errorWithCode('Disposable wallet permits only PaymentRouter.pay', 4_100);
        }
        if (
          transactionRecord.value !== undefined &&
          normalizeChainId(transactionRecord.value) !== 0n
        ) {
          throw errorWithCode('Disposable wallet rejects native-value transfers', 4_100);
        }
        if (
          transactionRecord.chainId !== undefined &&
          normalizeChainId(transactionRecord.chainId) !== BigInt(ANVIL_WALLET_CHAIN_ID)
        ) {
          throw errorWithCode(
            `Disposable wallet may send only on chain ID ${ANVIL_WALLET_CHAIN_ID}`,
            4_901,
          );
        }
        const activeAccounts = await checkedUnlockedAccounts();
        if (!activeAccounts.includes(account)) {
          throw errorWithCode('Selected unlocked Anvil account is no longer available', 4_100);
        }
        const result = await callAnvilRpc('eth_sendTransaction', request.params);
        if (typeof result !== 'string' || !HASH_PATTERN.test(result)) {
          throw errorWithCode('Local Anvil returned an invalid transaction hash', -32_000);
        }
        return { ok: true, hash: result.toLowerCase() as Hex, to };
      } catch (error) {
        return { ok: false, error: serializeRpcError(error) };
      }
    },
  );

  await page.addInitScript(
    ({
      account: selectedAccount,
      bindingName,
      chainId,
      chainIdHex,
      providerInfo,
      transactionRecordsName,
    }: {
      account: Address;
      bindingName: string;
      chainId: number;
      chainIdHex: string;
      providerInfo: typeof ANVIL_WALLET_PROVIDER_INFO;
      transactionRecordsName: string;
    }) => {
      type RequestArguments = {
        method: string;
        params?: readonly unknown[] | Record<string, unknown>;
      };
      type Listener = (...args: unknown[]) => void;
      type BrowserRpcBridge = (request: {
        method: string;
        params?: readonly unknown[];
      }) => Promise<RpcBridgeResponse>;

      class ProviderRpcError extends Error {
        readonly code: number;
        readonly data?: unknown;

        constructor(error: JsonRpcError) {
          super(error.message);
          this.name = 'ProviderRpcError';
          this.code = error.code;
          this.data = error.data;
        }
      }

      const listeners = new Map<string, Set<Listener>>();
      const records: AnvilWalletTransaction[] = [];
      const emit = (event: string, ...args: unknown[]): void => {
        for (const listener of listeners.get(event) ?? []) listener(...args);
      };
      const requireParamsArray = (params: RequestArguments['params']): readonly unknown[] => {
        if (params === undefined) return [];
        if (!Array.isArray(params)) {
          throw new ProviderRpcError({
            code: -32_602,
            message: 'Wallet RPC params must be an array',
          });
        }
        return params;
      };
      const requestedChainId = (params: readonly unknown[]): string | undefined => {
        const request = params[0];
        if (typeof request !== 'object' || request === null) return undefined;
        const value = (request as Record<string, unknown>).chainId;
        return typeof value === 'string' ? value.toLowerCase() : undefined;
      };
      const bridge = Reflect.get(window, bindingName) as BrowserRpcBridge | undefined;
      if (typeof bridge !== 'function') {
        throw new Error('Disposable Anvil RPC binding was not installed');
      }

      const provider = {
        request: async ({ method, params }: RequestArguments): Promise<unknown> => {
          const arrayParams = requireParamsArray(params);
          switch (method) {
            case 'eth_chainId':
              return chainIdHex;
            case 'net_version':
              return String(chainId);
            case 'eth_accounts':
              return [selectedAccount];
            case 'eth_requestAccounts':
              emit('accountsChanged', [selectedAccount]);
              return [selectedAccount];
            case 'wallet_switchEthereumChain':
            case 'wallet_addEthereumChain':
              if (requestedChainId(arrayParams) !== chainIdHex) {
                throw new ProviderRpcError({
                  code: 4_902,
                  message: `This disposable wallet knows only chain ID ${chainId}`,
                });
              }
              emit('chainChanged', chainIdHex);
              return null;
            case 'eth_sendTransaction': {
              const response = await bridge({ method, params: arrayParams });
              if (!response.ok) throw new ProviderRpcError(response.error);
              records.push(Object.freeze({ to: response.to, hash: response.hash }));
              return response.hash;
            }
            case 'personal_sign':
            case 'eth_sign':
            case 'eth_signTypedData':
            case 'eth_signTypedData_v3':
            case 'eth_signTypedData_v4':
              throw new ProviderRpcError({
                code: 4_200,
                message: 'The disposable payer does not permit message signing',
              });
            default:
              throw new ProviderRpcError({
                code: 4_200,
                message: `Unsupported disposable-wallet method: ${method}`,
              });
          }
        },
        on: (event: string, listener: Listener) => {
          const eventListeners = listeners.get(event) ?? new Set<Listener>();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
          return provider;
        },
        removeListener: (event: string, listener: Listener) => {
          listeners.get(event)?.delete(listener);
          return provider;
        },
      };

      Object.defineProperty(window, transactionRecordsName, {
        configurable: false,
        enumerable: false,
        get: () => records.map((record) => ({ ...record })),
      });
      const detail = Object.freeze({
        info: Object.freeze({ ...providerInfo }),
        provider,
      });
      const announceProvider = (): void => {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
      };
      Object.defineProperty(window, 'ethereum', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: provider,
      });
      window.addEventListener('eip6963:requestProvider', announceProvider);
      announceProvider();
    },
    {
      account,
      bindingName: RPC_BINDING_NAME,
      chainId: ANVIL_WALLET_CHAIN_ID,
      chainIdHex: ANVIL_WALLET_CHAIN_ID_HEX,
      providerInfo: ANVIL_WALLET_PROVIDER_INFO,
      transactionRecordsName: TRANSACTION_RECORDS_NAME,
    },
  );

  return {
    account,
    chainId: ANVIL_WALLET_CHAIN_ID,
    chainIdHex: ANVIL_WALLET_CHAIN_ID_HEX,
    rpcUrl: ANVIL_WALLET_RPC_URL,
    providerInfo: ANVIL_WALLET_PROVIDER_INFO,
  };
}

export async function readAnvilWalletTransactions(
  page: Page,
): Promise<readonly AnvilWalletTransaction[]> {
  const records = await page.evaluate((recordsName) => {
    const value = Reflect.get(window, recordsName);
    return Array.isArray(value) ? value : [];
  }, TRANSACTION_RECORDS_NAME);
  if (
    !records.every(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        ADDRESS_PATTERN.test(String((record as Record<string, unknown>).to ?? '')) &&
        HASH_PATTERN.test(String((record as Record<string, unknown>).hash ?? '')),
    )
  ) {
    throw new Error('Disposable wallet exposed an invalid transaction record');
  }
  return records.map((record) => ({
    to: String((record as Record<string, unknown>).to).toLowerCase() as Address,
    hash: String((record as Record<string, unknown>).hash).toLowerCase() as Hex,
  }));
}
