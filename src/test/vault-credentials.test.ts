import { describe, it, expect } from 'vitest';
import {
  parseVaultKvOutput,
  parseVaultJsonOutput,
  parseVaultSecretOutput,
  langfuseCredentialsFromVaultMap,
  fetchLangfuseCredentialsFromVault,
  pathWithExtraBinDirs,
  readSingleVaultSecretValue,
  substituteVaultCommandTemplate,
  buildHashicorpVaultArgs,
  isVaultCredentialSettingsComplete,
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

describe('parseVaultJsonOutput', () => {
  it('reads nested HashiCorp KV v2 data', () => {
    expect(parseVaultJsonOutput(JSON.stringify({
      data: {
        data: {
          public_key: 'pk-json',
          secret_key: 'sk-json',
          host: 'https://lf.example',
        },
      },
    }))).toEqual({
      public_key: 'pk-json',
      secret_key: 'sk-json',
      host: 'https://lf.example',
    });
  });
});

describe('parseVaultSecretOutput', () => {
  it('auto-detects JSON output', () => {
    expect(parseVaultSecretOutput('{"data":{"data":{"value":"pk-1"}}}', 'auto')).toEqual({
      value: 'pk-1',
    });
  });

  it('parses key:value output when auto mode receives plain text', () => {
    expect(parseVaultSecretOutput('value:pk-1\n', 'auto')).toEqual({ value: 'pk-1' });
  });
});

describe('substituteVaultCommandTemplate', () => {
  it('replaces known placeholders', () => {
    expect(substituteVaultCommandTemplate('{cli} secrets get --env {env} {path}', {
      cli: 'my-secrets-cli',
      env: 'prod',
      mount: 'secret',
      path: 'apps/langfuse',
    })).toBe('my-secrets-cli secrets get --env prod apps/langfuse');
  });
});

describe('buildHashicorpVaultArgs', () => {
  it('builds standard vault kv get args', () => {
    expect(buildHashicorpVaultArgs('secret', 'apps/langfuse')).toEqual([
      'kv', 'get', '-mount', 'secret', '-format', 'json', 'apps/langfuse',
    ]);
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

describe('isVaultCredentialSettingsComplete', () => {
  it('accepts hashicorp settings with a combined path', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: 'vault',
      mount: 'secret',
      env: '',
      commandTemplate: '',
      outputFormat: 'json',
      path: 'apps/langfuse',
      publicKeyPath: '',
      secretKeyPath: '',
      field: 'value',
    })).toBe(true);
  });

  it('requires env when custom template uses {env}', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: 'my-secrets-cli',
      mount: 'secret',
      env: '',
      commandTemplate: '{cli} secrets get --env {env} {path}',
      outputFormat: 'auto',
      path: 'apps/langfuse',
      publicKeyPath: '',
      secretKeyPath: '',
      field: 'value',
    })).toBe(false);
  });
});

describe('fetchLangfuseCredentialsFromVault', () => {
  it('fetches a combined secret via hashicorp vault args', async () => {
    const calls: Array<{ cli: string; path: string }> = [];
    const config = await fetchLangfuseCredentialsFromVault({
      cli: 'vault',
      mount: 'secret',
      env: '',
      commandTemplate: '',
      outputFormat: 'json',
      path: 'apps/langfuse/credentials',
      publicKeyPath: '',
      secretKeyPath: '',
      field: 'value',
      runVault: async (settings, vaultPath) => {
        calls.push({ cli: settings.cli, path: vaultPath });
        return JSON.stringify({
          data: {
            data: {
              public_key: 'pk-1',
              secret_key: 'sk-1',
              host: 'https://lf.example',
            },
          },
        });
      },
    });
    expect(calls).toEqual([{ cli: 'vault', path: 'apps/langfuse/credentials' }]);
    expect(config).toEqual({
      host: 'https://lf.example',
      publicKey: 'pk-1',
      secretKey: 'sk-1',
    });
  });

  it('fetches split secrets via a custom command template', async () => {
    const calls: string[] = [];
    const config = await fetchLangfuseCredentialsFromVault({
      cli: 'my-secrets-cli',
      mount: 'secret',
      env: 'staging',
      commandTemplate: '{cli} secrets get --env {env} {path}',
      outputFormat: 'keyvalue',
      publicKeyPath: 'apps/demo/langfuse-public-key',
      secretKeyPath: 'apps/demo/langfuse-secret-key',
      path: '',
      field: 'value',
      runVault: async (_settings, vaultPath) => {
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

  it('requires env when custom template references {env}', async () => {
    await expect(fetchLangfuseCredentialsFromVault({
      cli: 'my-secrets-cli',
      mount: 'secret',
      env: '',
      commandTemplate: '{cli} secrets get --env {env} {path}',
      outputFormat: 'auto',
      path: 'apps/langfuse',
      publicKeyPath: '',
      secretKeyPath: '',
      field: 'value',
      runVault: async () => '',
    })).rejects.toThrow(/langfuse\.vault\.env/);
  });
});

describe('pathWithExtraBinDirs', () => {
  it('appends common bin locations without duplicating PATH entries', () => {
    const result = pathWithExtraBinDirs('/usr/bin');
    expect(result.split(':')[0]).toBe('/usr/bin');
    expect(result).toContain('/.bin');
  });
});
