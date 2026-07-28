import { eq, merchantSignerKeys, type Database } from '@giwapay/db';

export type MerchantSignerKey = {
  provider: 'aws-kms';
  keyId: string;
  address: `0x${string}`;
};

export interface MerchantSignerKeyStore {
  readiness(): Promise<boolean>;
  getByMerchantId(merchantId: string): Promise<MerchantSignerKey | undefined>;
}

export class DatabaseMerchantSignerKeyStore implements MerchantSignerKeyStore {
  public constructor(private readonly db: Database) {}

  public async readiness(): Promise<boolean> {
    await this.db
      .select({ merchantId: merchantSignerKeys.merchantId })
      .from(merchantSignerKeys)
      .limit(1);
    return true;
  }

  public async getByMerchantId(merchantId: string): Promise<MerchantSignerKey | undefined> {
    const [row] = await this.db
      .select({
        provider: merchantSignerKeys.provider,
        keyId: merchantSignerKeys.keyId,
        address: merchantSignerKeys.signerAddress,
      })
      .from(merchantSignerKeys)
      .where(eq(merchantSignerKeys.merchantId, merchantId))
      .limit(1);
    if (!row) return undefined;
    return {
      provider: row.provider,
      keyId: row.keyId,
      address: row.address as `0x${string}`,
    };
  }
}
