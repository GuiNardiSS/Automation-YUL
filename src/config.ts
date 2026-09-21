export interface Config {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpAppPassword: string;
  recipientEmails: string[];
  redisUrl: string;
  redisSeenTtlSeconds: number;
  pncpApiBaseUrl: string;
  pncpUfs: string[];
  pncpModalidadeCodes: number[];
  pncpLookbackDays: number;
  pncpPageSize: number;
  pncpRequestDelayMs: number;
  pollTimezone: string;
  emailDigestThreshold: number;
  logLevel: string;
  logDir: string;
}

const REQUIRED_KEYS = ['SMTP_USER', 'SMTP_APP_PASSWORD', 'RECIPIENT_EMAILS', 'REDIS_URL'] as const;

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalString(env: Record<string, string | undefined>, key: string, fallback: string): string {
  return env[key] ?? fallback;
}

function optionalNumber(env: Record<string, string | undefined>, key: string, fallback: number): number {
  if (env[key] === undefined) {
    return fallback;
  }
  const value = Number(env[key]);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${key} must be a number, got: ${env[key]}`);
  }
  return value;
}

function optionalBoolean(env: Record<string, string | undefined>, key: string, fallback: boolean): boolean {
  return env[key] !== undefined ? env[key] === 'true' : fallback;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  for (const key of REQUIRED_KEYS) {
    requireEnv(env, key);
  }

  return {
    smtpHost: optionalString(env, 'SMTP_HOST', 'smtp.gmail.com'),
    smtpPort: optionalNumber(env, 'SMTP_PORT', 465),
    smtpSecure: optionalBoolean(env, 'SMTP_SECURE', true),
    smtpUser: requireEnv(env, 'SMTP_USER'),
    smtpAppPassword: requireEnv(env, 'SMTP_APP_PASSWORD'),
    recipientEmails: splitList(requireEnv(env, 'RECIPIENT_EMAILS')),
    redisUrl: requireEnv(env, 'REDIS_URL'),
    redisSeenTtlSeconds: optionalNumber(env, 'REDIS_SEEN_TTL_SECONDS', 7776000),
    pncpApiBaseUrl: optionalString(env, 'PNCP_API_BASE_URL', 'https://pncp.gov.br/api/consulta'),
    pncpUfs: splitList(optionalString(env, 'PNCP_UFS', 'SC,PR,RS')),
    pncpModalidadeCodes: splitList(optionalString(env, 'PNCP_MODALIDADE_CODES', '1,2,3,4,5,6,7,8,9,10,11,12,13')).map(
      Number,
    ),
    pncpLookbackDays: optionalNumber(env, 'PNCP_LOOKBACK_DAYS', 1),
    pncpPageSize: optionalNumber(env, 'PNCP_PAGE_SIZE', 50),
    pncpRequestDelayMs: optionalNumber(env, 'PNCP_REQUEST_DELAY_MS', 1500),
    pollTimezone: optionalString(env, 'POLL_TIMEZONE', 'America/Sao_Paulo'),
    emailDigestThreshold: optionalNumber(env, 'EMAIL_DIGEST_THRESHOLD', 10),
    logLevel: optionalString(env, 'LOG_LEVEL', 'info'),
    logDir: optionalString(env, 'LOG_DIR', './logs'),
  };
}
