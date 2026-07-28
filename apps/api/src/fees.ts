export function calculatePlatformFee(amount: bigint, basisPoints: number): bigint {
  if (amount < 0n || !Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new RangeError('Invalid platform fee inputs');
  }
  return (amount * BigInt(basisPoints) + 9_999n) / 10_000n;
}
