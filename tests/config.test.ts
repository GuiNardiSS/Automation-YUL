import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

function baseEnv(): Record<string, string> {
  return {
    SMTP_USER: 'alerts@example.com',
    SMTP_APP_PASSWORD: 'app-password',
    RECIPIENT_EMAILS: 'client@example.com,ops@example.com',
    REDIS_URL: 'redis://localhost:6379',
  };
}

describe('loadConfig', () => {
  it('loads successfully when all required variables are present', () => {
    expect(() => loadConfig(baseEnv())).not.toThrow();
  });

  it.each(['SMTP_USER', 'SMTP_APP_PASSWORD', 'RECIPIENT_EMAILS', 'REDIS_URL'])(
    'throws an error naming %s when it is missing',
    (missingKey) => {
      const env = baseEnv();
      delete env[missingKey];
      expect(() => loadConfig(env)).toThrow(new RegExp(missingKey));
    },
  );

  it('parses the comma-separated recipient list into an array', () => {
    const config = loadConfig(baseEnv());
    expect(config.recipientEmails).toEqual(['client@example.com', 'ops@example.com']);
  });

  it('applies documented defaults for optional variables when omitted', () => {
    const config = loadConfig(baseEnv());
    expect(config.smtpHost).toBe('smtp.gmail.com');
    expect(config.smtpPort).toBe(465);
    expect(config.smtpSecure).toBe(true);
    expect(config.redisSeenTtlSeconds).toBe(7776000);
    expect(config.pncpApiBaseUrl).toBe('https://pncp.gov.br/api/consulta');
    expect(config.pncpUfs).toEqual(['SC', 'PR', 'RS']);
    expect(config.pncpModalidadeCodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(config.pncpLookbackDays).toBe(1);
    expect(config.pncpPageSize).toBe(50);
    expect(config.pncpRequestDelayMs).toBe(6000);
    expect(config.pollTimezone).toBe('America/Sao_Paulo');
    expect(config.emailDigestThreshold).toBe(10);
    expect(config.logLevel).toBe('info');
    expect(config.logDir).toBe('./logs');
  });

  it('honors an explicitly provided optional variable over its default', () => {
    const config = loadConfig({ ...baseEnv(), EMAIL_DIGEST_THRESHOLD: '25' });
    expect(config.emailDigestThreshold).toBe(25);
  });

  it('throws an error naming the variable when a numeric variable is not a number', () => {
    expect(() => loadConfig({ ...baseEnv(), PNCP_PAGE_SIZE: 'fifty' })).toThrow(/PNCP_PAGE_SIZE/);
  });

  it('ignores empty entries from trailing commas in comma-separated lists', () => {
    const config = loadConfig({ ...baseEnv(), RECIPIENT_EMAILS: 'client@example.com,' });
    expect(config.recipientEmails).toEqual(['client@example.com']);
  });
});
