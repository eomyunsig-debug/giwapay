const allowedConnectProtocols = new Set(['http:', 'https:', 'ws:', 'wss:']);
const walletConnectOrigins = [
  'https://relay.walletconnect.com',
  'wss://relay.walletconnect.com',
  'https://pulse.walletconnect.org',
  'https://verify.walletconnect.com',
] as const;

export function walletConnectRelayOrigins(projectId: string | undefined): readonly string[] {
  return projectId?.trim() ? walletConnectOrigins : [];
}

export function safeConnectOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!allowedConnectProtocols.has(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function safeConfiguredConnectOrigins(values: ReadonlyArray<string | undefined>): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => value?.split(',') ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
        .map(safeConnectOrigin)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export function buildContentSecurityPolicy(options: {
  connectOrigins: readonly string[];
  isDevelopment: boolean;
}): string {
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(options.isDevelopment ? ["'unsafe-eval'"] : []),
  ];
  const connectSources = [
    "'self'",
    ...options.connectOrigins,
    ...(options.isDevelopment ? ['http:', 'https:', 'ws:', 'wss:'] : []),
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSources.join(' ')}`,
    `connect-src ${connectSources.join(' ')}`,
  ].join('; ');
}
