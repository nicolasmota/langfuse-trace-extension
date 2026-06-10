import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readLangfuseConfigFromEnv } from '../langfuse-env.js';
import { defaultLangfuseConfig } from '../langfuse-client.js';

describe('readLangfuseConfigFromEnv', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['LANGFUSE_HOST', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY']) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('falls back to defaults when env vars are unset', () => {
    const defaults = defaultLangfuseConfig();
    expect(readLangfuseConfigFromEnv()).toEqual(defaults);
  });

  it('reads Langfuse settings from environment variables', () => {
    process.env.LANGFUSE_HOST = ' http://custom:3000 ';
    process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
    process.env.LANGFUSE_SECRET_KEY = 'sk-test';
    expect(readLangfuseConfigFromEnv()).toEqual({
      host: 'http://custom:3000',
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    });
  });
});
