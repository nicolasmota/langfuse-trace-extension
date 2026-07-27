import { describe, it, expect } from 'vitest';
import { isVaultCredentialSettingsComplete } from '../vault-credentials.js';

describe('isVaultCredentialSettingsComplete', () => {
  it('requires cli', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: '',
      mount: 'secret',
      env: '',
      commandTemplate: '',
      outputFormat: 'json',
      path: 'apps/langfuse',
      publicKeyPath: '',
      secretKeyPath: '',
      field: 'value',
    })).toBe(false);
  });

  it('accepts a combined secret path for hashicorp mode', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: 'vault',
      mount: 'secret',
      env: '',
      commandTemplate: '',
      outputFormat: 'json',
      path: 'apps/langfuse/credentials',
      publicKeyPath: '',
      secretKeyPath: '',
      field: 'value',
    })).toBe(true);
  });

  it('accepts split public and secret paths', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: 'vault',
      mount: 'secret',
      env: '',
      commandTemplate: '',
      outputFormat: 'json',
      path: '',
      publicKeyPath: 'apps/langfuse/public-key',
      secretKeyPath: 'apps/langfuse/secret-key',
      field: 'value',
    })).toBe(true);
  });

  it('rejects split paths when only one side is set', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: 'vault',
      mount: 'secret',
      env: '',
      commandTemplate: '',
      outputFormat: 'json',
      path: '',
      publicKeyPath: 'apps/langfuse/public-key',
      secretKeyPath: '',
      field: 'value',
    })).toBe(false);
  });

  it('requires env for custom templates that use {env}', () => {
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
