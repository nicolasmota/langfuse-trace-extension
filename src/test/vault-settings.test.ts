import { describe, it, expect } from 'vitest';
import { isVaultCredentialSettingsComplete } from '../vault-credentials.js';

describe('isVaultCredentialSettingsComplete', () => {
  it('requires cli and env', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: '',
      env: 'prod',
      path: 'apps/langfuse',
      publicKeyPath: '',
      secretKeyPath: '',
      field: 'value',
    })).toBe(false);
  });

  it('accepts a combined secret path', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: 'vault',
      env: 'prod',
      path: 'apps/langfuse/credentials',
      publicKeyPath: '',
      secretKeyPath: '',
      field: 'value',
    })).toBe(true);
  });

  it('accepts split public and secret paths', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: 'vault',
      env: 'prod',
      path: '',
      publicKeyPath: 'apps/langfuse/public-key',
      secretKeyPath: 'apps/langfuse/secret-key',
      field: 'value',
    })).toBe(true);
  });

  it('rejects split paths when only one side is set', () => {
    expect(isVaultCredentialSettingsComplete({
      cli: 'vault',
      env: 'prod',
      path: '',
      publicKeyPath: 'apps/langfuse/public-key',
      secretKeyPath: '',
      field: 'value',
    })).toBe(false);
  });
});
