import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_WEBHOOK_SECRET = 'kana-secret-change-me-in-dev-environment-haha-meow';

interface RuntimeEnvConfig {
  jwtSecret: string;
  webhookSecret: string;
  nodeEnv: string;
  environment: string;
  createdKeys: string[];
}

const ENV_FILE_NAME = '.env';

const getNonEmpty = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseEnvFile = (content: string): Record<string, string> => {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const rawValue = line.slice(separatorIndex + 1).trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
    result[key] = value;
  }
  return result;
};

const serializeEnvValue = (value: string): string => {
  if (/^[A-Za-z0-9_./:-]+$/u.test(value)) {
    return value;
  }
  return JSON.stringify(value);
};

const appendEnvEntries = (envPath: string, entries: Array<[string, string]>): void => {
  if (entries.length === 0) {
    return;
  }

  const unique = new Map<string, string>();
  for (const [key, value] of entries) {
    if (!unique.has(key)) {
      unique.set(key, value);
    }
  }

  const serialized = Array.from(unique.entries())
    .map(([key, value]) => `${key}=${serializeEnvValue(value)}`)
    .join('\n');

  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(envPath, `${prefix}${serialized}\n`, 'utf8');
};

const ensureRuntimeEnv = (): RuntimeEnvConfig => {
  const envPath = path.join(process.cwd(), ENV_FILE_NAME);
  const envFileContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const envFromFile = parseEnvFile(envFileContent);
  const beforeLoad = { ...process.env };

  for (const [key, value] of Object.entries(envFromFile)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const createdEntries: Array<[string, string]> = [];

  const resolveValue = (key: string, fallback: () => string): string => {
    const existing = getNonEmpty(process.env[key]);
    if (existing) {
      return existing;
    }

    const nextValue = fallback();
    process.env[key] = nextValue;
    if (!getNonEmpty(envFromFile[key]) && !getNonEmpty(beforeLoad[key])) {
      createdEntries.push([key, nextValue]);
    }
    return nextValue;
  };

  const jwtSecret = resolveValue('JWT_SECRET', () => randomBytes(16).toString('hex'));
  const webhookSecret = resolveValue('WEBHOOK_SECRET', () => DEFAULT_WEBHOOK_SECRET);

  const environment = resolveValue('environment', () => 'production');
  const nodeEnv = resolveValue('NODE_ENV', () => environment);

  appendEnvEntries(envPath, createdEntries);

  return {
    jwtSecret,
    webhookSecret,
    nodeEnv,
    environment,
    createdKeys: createdEntries.map(([key]) => key),
  };
};

export { DEFAULT_WEBHOOK_SECRET, ensureRuntimeEnv };
export type { RuntimeEnvConfig };
