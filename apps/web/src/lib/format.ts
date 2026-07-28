import type { Address } from 'viem';

export const shortAddress = (address?: Address | string): string => {
  if (!address) return '—';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
};

export const formatDateTime = (value: string, locale = 'ko-KR'): string =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));

export const formatBasisPoints = (basisPoints: number): string =>
  `${(basisPoints / 100).toFixed(2)}%`;

export const isFinalPaymentStatus = (status: string): boolean =>
  ['succeeded', 'expired', 'refunded'].includes(status);

type AmountRounding = 'nearest' | 'up';

const groupWhole = (value: string): string => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function formatPositiveRawAmount(
  raw: bigint,
  decimals: number,
  maximumFractionDigits: number,
  rounding: AmountRounding,
): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('Token decimals must be an integer between 0 and 36');
  }
  if (!Number.isInteger(maximumFractionDigits) || maximumFractionDigits < 0) {
    throw new Error('Maximum fraction digits must be a non-negative integer');
  }
  if (decimals === 0) return groupWhole(raw.toString());

  const scale = 10n ** BigInt(decimals);
  let whole = raw / scale;
  const remainder = raw % scale;
  if (remainder === 0n) return groupWhole(whole.toString());

  const fraction = remainder.toString().padStart(decimals, '0');
  const firstNonZero = fraction.search(/[1-9]/);
  const adaptiveLimit = Math.min(decimals, Math.max(maximumFractionDigits, 12));
  if (whole === 0n && firstNonZero >= adaptiveLimit) {
    return `<0.${'0'.repeat(Math.max(0, adaptiveLimit - 1))}1`;
  }

  const visibleDigits = Math.min(
    decimals,
    Math.max(maximumFractionDigits, whole === 0n ? firstNonZero + 3 : 0),
  );
  if (visibleDigits === decimals) {
    return `${groupWhole(whole.toString())}.${fraction.replace(/0+$/, '')}`;
  }

  const hiddenScale = 10n ** BigInt(decimals - visibleDigits);
  let visibleFraction =
    rounding === 'up'
      ? (remainder + hiddenScale - 1n) / hiddenScale
      : (remainder + hiddenScale / 2n) / hiddenScale;
  const visibleScale = 10n ** BigInt(visibleDigits);
  if (visibleFraction >= visibleScale) {
    whole += 1n;
    visibleFraction = 0n;
  }
  const trimmed = visibleFraction.toString().padStart(visibleDigits, '0').replace(/0+$/, '');
  return trimmed ? `${groupWhole(whole.toString())}.${trimmed}` : groupWhole(whole.toString());
}

export const formatRawAmount = (
  raw: string,
  decimals: number,
  maximumFractionDigits = 6,
): string => {
  const amount = BigInt(raw);
  const sign = amount < 0n ? '-' : '';
  return `${sign}${formatPositiveRawAmount(
    amount < 0n ? -amount : amount,
    decimals,
    maximumFractionDigits,
    'nearest',
  )}`;
};

/** Formats a user-authorized ceiling without ever rounding the value down. */
export const formatMaximumRawAmount = (
  raw: string,
  decimals: number,
  maximumFractionDigits = 6,
): string => {
  const amount = BigInt(raw);
  if (amount < 0n) throw new Error('Maximum token amount cannot be negative');
  return formatPositiveRawAmount(amount, decimals, maximumFractionDigits, 'up');
};

export const formatConfiguredAmount = (
  raw: string,
  token: { decimals: number } | undefined,
): string => (token ? formatRawAmount(raw, token.decimals) : `${raw} atomic units`);
