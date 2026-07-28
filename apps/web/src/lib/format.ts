import type { Address } from 'viem';
import { formatUnits } from 'viem';

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

export const formatRawAmount = (
  raw: string,
  decimals: number,
  maximumFractionDigits = 6,
): string => {
  const value = formatUnits(BigInt(raw), decimals);
  const [whole = '0', fraction = ''] = value.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '');
  return trimmed ? `${groupedWhole}.${trimmed}` : groupedWhole;
};
