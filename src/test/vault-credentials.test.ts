import { describe, it, expect } from 'vitest';
import {
  parseVaultKvOutput,
  langfuseCredentialsFromVaultMap,
  fetchLangfuseCredentialsFromVault,
  pathWithExtraBinDirs,
  readSingleVaultSecretValue,
} from '../vault-credentials.js';

describe('parseVaultKvOutput', () => {
  it('parses key:value lines and ignores blanks', () => {
    expect(parseVaultKvOutput('public_key:pk-abc\n\nsecret_key:sk-xyz\n')).toEqual({
      public_key: 'pk-abc',
      secret_key: 'sk-xyz',
    });
  });

  it('keeps colons inside values', () => {
    expect(parseVaultKvOutput('host:https://langfuse.example.com/path')).toEqual({
      host: 'https://langfuse.example.com/path',
    });
  });
});

describe('readSingleVaultSecretValue', () => {
  it('reads the configured field from a single-key secret', () => {
    expect(readSingleVaultSecretValue({ value: 'pk-1' }, 'value', ['public_key']))
      .toBe('pk-1');
  });
});

describe('langfuseCredentialsFromVaultMap', () => {
  it('maps aliases and omits host when absent', () => {
    expect(langfuseCredentialsFromVaultMap({
      PUBLIC_KEY: ' pk-from-vault ',
      SECRET_KEY: 'sk-from-vault',
    })).toEqual({
      publicKey: 'pk-from-vault',
      secretKey: 'sk-from-vault',
      host: undefined,
    });
  });

  it('includes host when present', () => {
    expect(langfuseCredentialsFromVaultMap({
      public_key: 'pk',
      secret_key: 'sk',
      HOST: 'https://langfuse.example.com',
    })).toEqual({
      publicKey: 'pk',
      secretKey: 'sk',
      host: 'https://langfuse.example.com',
    });
  });

  it('throws when required keys are missing', () => {
    expect(() => langfuseCredentialsFromVaultMap({ host: 'https://x' }))
      .toThrow(/missing public_key\/secret_key/);
  });
});

describe('fetchLangfuseCredentialsFromVault', () => {
  it('requires cli and env', async () => {
    await expect(fetchLangfuseCredentialsFromVault({
      cli: '',
      env: 'staging',
      path: 'secret/langfuse',
      runVault: async () => '',
    })).rejects.toThrow(/Configure langfuse\.vault\.cli/);
  });

  it('fetches a combined secret path', async () => {
    const calls: Array<{ cli: string; args: string[] }> = [];
    const config = await fetchLangfuseCredentialsFromVault({
      cli: 'vault-cli',
      env: 'staging',
      path: 'secret/langfuse/mcp',
      runVault: async (cli, args) => {
        calls.push({ cli, args });
        return 'public_key:pk-1\nsecret_key:sk-1\nhost:https://lf.example\n';
      },
    });
    expect(calls).toEqual([
      {
        cli: 'vault-cli',
        args: ['kv', 'get', '-e', 'staging', 'secret/langfuse/mcp', '--no-prompt'],
      },
    ]);
    expect(config).toEqual({
      host: 'https://lf.example',
      publicKey: 'pk-1',
      secretKey: 'sk-1',
    });
  });

  it('fetches split public/secret secret paths', async () => {
    const calls: string[] = [];
    const config = await fetchLangfuseCredentialsFromVault({
      cli: 'vault-cli',
      env: 'staging',
      publicKeyPath: 'apps/demo/langfuse-public-key',
      secretKeyPath: 'apps/demo/langfuse-secret-key',
      field: 'value',
      runVault: async (_cli, args) => {
        const vaultPath = args[4];
        calls.push(vaultPath);
        if (vaultPath.endsWith('public-key')) {
          return 'value:pk-split\n';
        }
        return 'value:sk-split\n';
      },
    });
    expect(calls.sort()).toEqual([
      'apps/demo/langfuse-public-key',
      'apps/demo/langfuse-secret-key',
    ]);
    expect(config).toEqual({
      publicKey: 'pk-split',
      secretKey: 'sk-split',
    });
  });
});

describe('pathWithExtraBinDirs', () => {
  it('appends common bin locations without duplicating PATH entries', () => {
    const result = pathWithExtraBinDirs('/usr/bin');
    expect(result.split(':')[0]).toBe('/usr/bin');
    expect(result).toContain('/.bin');
  });
});
