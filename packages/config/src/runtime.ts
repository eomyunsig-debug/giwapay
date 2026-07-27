import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .default(false);

export const deploymentEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GIWA_RPC_URL: z.url().optional(),
  GIWA_RPC_FALLBACK_URLS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((url) => url.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.url())),
  ALLOW_TEST_CONTRACTS: booleanFromString,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().min(1).optional(),
  SENTRY_DSN: z.url().optional(),
});

export type DeploymentEnvironment = z.infer<typeof deploymentEnvironmentSchema>;

export function parseDeploymentEnvironment(
  environment: Record<string, string | undefined>,
): DeploymentEnvironment {
  const parsed = deploymentEnvironmentSchema.parse(environment);
  if (parsed.NODE_ENV === 'production' && parsed.ALLOW_TEST_CONTRACTS) {
    throw new Error('Production configuration must not enable test contracts');
  }
  return parsed;
}
