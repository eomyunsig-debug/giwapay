import Link from 'next/link';

export function Brand({
  compact = false,
  network = 'Sepolia',
}: {
  compact?: boolean;
  network?: string;
}) {
  return (
    <Link className="brand" href="/" aria-label="GiwaPay home">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span className="brand-word">
        Giwa<span>Pay</span>
      </span>
      {!compact ? <span className="brand-network">{network}</span> : null}
    </Link>
  );
}
