import 'dotenv/config';

import { DescribeKeyCommand, GetPublicKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { createDatabase, eq, merchantSignerKeys, merchants } from '@giwapay/db';
import { getAddress } from 'viem';

import { loadConfig } from './env.js';
import { kmsPublicKeyAddress } from './signer.js';

type Arguments = {
  merchant: `0x${string}`;
  keyId: string;
  replace: boolean;
};

function parseArguments(argv: string[]): Arguments {
  let merchant: `0x${string}` | undefined;
  let keyId: string | undefined;
  let replace = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--replace') {
      replace = true;
      continue;
    }
    if (argument === '--merchant') {
      const value = argv[index + 1];
      if (!value) throw new Error('--merchant requires an address');
      merchant = getAddress(value).toLowerCase() as `0x${string}`;
      index += 1;
      continue;
    }
    if (argument === '--key-id') {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error('--key-id requires a KMS key ID, ARN, or alias');
      if (value.length > 2_048) throw new Error('--key-id must be 2048 characters or fewer');
      keyId = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? ''}`);
  }

  if (!merchant || !keyId) {
    throw new Error('Usage: signer:provision -- --merchant 0x... --key-id alias/... [--replace]');
  }
  return { merchant, keyId, replace };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const config = loadConfig();
  if (config.paymentIntentSignerSource !== 'database') {
    throw new Error('Set PAYMENT_INTENT_SIGNER_SOURCE=database before provisioning DB keys');
  }
  if (!config.AWS_REGION) throw new Error('AWS_REGION is required');
  if (!config.AWS_KMS_READINESS_KEY_ID) {
    throw new Error('AWS_KMS_READINESS_KEY_ID is required');
  }

  const database = createDatabase(config.DATABASE_URL);
  try {
    const [merchant] = await database.db
      .select()
      .from(merchants)
      .where(eq(merchants.onchainMerchantAddress, args.merchant))
      .limit(1);
    if (!merchant) {
      throw new Error('Merchant must sign in once before its signer key can be provisioned');
    }

    const kms = new KMSClient({
      region: config.AWS_REGION,
      ...(config.AWS_KMS_ENDPOINT ? { endpoint: config.AWS_KMS_ENDPOINT } : {}),
    });
    const result = await kms.send(new GetPublicKeyCommand({ KeyId: args.keyId }), {
      abortSignal: AbortSignal.timeout(config.AWS_KMS_TIMEOUT_MS),
    });
    if (
      result.KeySpec !== 'ECC_SECG_P256K1' ||
      result.KeyUsage !== 'SIGN_VERIFY' ||
      !result.PublicKey ||
      !result.KeyId
    ) {
      throw new Error('KMS key must be an ECC_SECG_P256K1 SIGN_VERIFY key');
    }
    const readinessKey = await kms.send(
      new DescribeKeyCommand({ KeyId: config.AWS_KMS_READINESS_KEY_ID }),
      { abortSignal: AbortSignal.timeout(config.AWS_KMS_TIMEOUT_MS) },
    );
    if (!readinessKey.KeyMetadata?.KeyId) {
      throw new Error('Dedicated KMS readiness key could not be resolved');
    }
    if (readinessKey.KeyMetadata.KeyId === result.KeyId) {
      throw new Error('A merchant signing key must not reuse the dedicated readiness key');
    }
    const signerAddress = kmsPublicKeyAddress(result.PublicKey).toLowerCase() as `0x${string}`;

    await database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(merchantSignerKeys)
        .where(eq(merchantSignerKeys.merchantId, merchant.id))
        .limit(1);
      const unchanged = existing?.keyId === args.keyId && existing.signerAddress === signerAddress;
      if (existing && !unchanged && !args.replace) {
        throw new Error(
          'Signer mapping already exists; pass --replace for an intentional rotation',
        );
      }
      if (
        merchant.delegatedSignerAddress &&
        merchant.delegatedSignerAddress !== signerAddress &&
        !args.replace
      ) {
        throw new Error(
          'KMS signer differs from the verified on-chain signer; pass --replace only during a reviewed rotation',
        );
      }

      await tx
        .insert(merchantSignerKeys)
        .values({
          merchantId: merchant.id,
          provider: 'aws-kms',
          keyId: args.keyId,
          signerAddress,
        })
        .onConflictDoUpdate({
          target: merchantSignerKeys.merchantId,
          set: {
            provider: 'aws-kms',
            keyId: args.keyId,
            signerAddress,
            updatedAt: new Date(),
          },
        });
    });

    process.stdout.write(
      `${JSON.stringify({
        merchant: merchant.onchainMerchantAddress,
        provider: 'aws-kms',
        keyId: args.keyId,
        signerAddress,
      })}\n`,
    );
  } finally {
    await database.close();
  }
}

await main();
