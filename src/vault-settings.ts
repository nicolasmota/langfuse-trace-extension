import * as vscode from 'vscode';
import {
  type VaultCredentialSettings,
  isVaultCredentialSettingsComplete,
} from './vault-credentials';

export { isVaultCredentialSettingsComplete, type VaultCredentialSettings };

/**
 * Persists Vault CLI settings to the user's global VS Code configuration.
 */
export async function saveVaultCredentialSettings(settings: VaultCredentialSettings): Promise<void> {
  const config = vscode.workspace.getConfiguration('langfuse');
  const target = vscode.ConfigurationTarget.Global;
  await Promise.all([
    config.update('vault.cli', settings.cli, target),
    config.update('vault.env', settings.env, target),
    config.update('vault.path', settings.path, target),
    config.update('vault.publicKeyPath', settings.publicKeyPath, target),
    config.update('vault.secretKeyPath', settings.secretKeyPath, target),
    config.update('vault.field', settings.field, target),
  ]);
}

type VaultSecretLayout = 'combined' | 'split';

/**
 * Guides the user through configuring Vault CLI settings via input prompts.
 * Returns true when settings were saved and are complete enough for sync.
 */
export async function configureVaultCredentialSettings(
  existing?: VaultCredentialSettings,
): Promise<boolean> {
  const current = existing ?? readVaultCredentialSettingsFromConfig();

  const cli = await vscode.window.showInputBox({
    title: 'Configure Langfuse Vault — CLI',
    prompt: 'Executable used to run Vault KV get (must be on PATH or an absolute path)',
    placeHolder: 'e.g. vault',
    value: current.cli,
    ignoreFocusOut: true,
    validateInput: value => (value.trim() ? undefined : 'Vault CLI is required'),
  });
  if (cli === undefined) {
    return false;
  }

  const env = await vscode.window.showInputBox({
    title: 'Configure Langfuse Vault — Environment',
    prompt: 'Vault environment passed as -e when fetching secrets',
    placeHolder: 'e.g. production',
    value: current.env,
    ignoreFocusOut: true,
    validateInput: value => (value.trim() ? undefined : 'Vault environment is required'),
  });
  if (env === undefined) {
    return false;
  }

  const defaultLayout: VaultSecretLayout = current.publicKeyPath.trim() && current.secretKeyPath.trim()
    ? 'split'
    : 'combined';
  const layoutPick = await vscode.window.showQuickPick(
    [
      {
        label: 'Combined secret',
        description: 'One Vault path with public_key and secret_key',
        layout: 'combined' as const,
      },
      {
        label: 'Split secrets',
        description: 'Separate Vault paths for public and secret keys',
        layout: 'split' as const,
      },
    ],
    {
      title: 'Configure Langfuse Vault — Secret layout',
      placeHolder: 'How are Langfuse keys stored in Vault?',
      ignoreFocusOut: true,
    },
  );
  if (!layoutPick) {
    return false;
  }
  const layout = layoutPick.layout ?? defaultLayout;

  let path = '';
  let publicKeyPath = '';
  let secretKeyPath = '';

  if (layout === 'combined') {
    const combinedPath = await vscode.window.showInputBox({
      title: 'Configure Langfuse Vault — Combined path',
      prompt: 'Vault KV path containing public_key and secret_key (optional host)',
      placeHolder: 'e.g. apps/langfuse/credentials',
      value: current.path,
      ignoreFocusOut: true,
      validateInput: value => (value.trim() ? undefined : 'Combined Vault path is required'),
    });
    if (combinedPath === undefined) {
      return false;
    }
    path = combinedPath.trim();
  } else {
    const publicPath = await vscode.window.showInputBox({
      title: 'Configure Langfuse Vault — Public key path',
      prompt: 'Vault KV path for the Langfuse public key',
      placeHolder: 'e.g. apps/langfuse/public-key',
      value: current.publicKeyPath,
      ignoreFocusOut: true,
      validateInput: value => (value.trim() ? undefined : 'Public key path is required'),
    });
    if (publicPath === undefined) {
      return false;
    }

    const secretPath = await vscode.window.showInputBox({
      title: 'Configure Langfuse Vault — Secret key path',
      prompt: 'Vault KV path for the Langfuse secret key',
      placeHolder: 'e.g. apps/langfuse/secret-key',
      value: current.secretKeyPath,
      ignoreFocusOut: true,
      validateInput: value => (value.trim() ? undefined : 'Secret key path is required'),
    });
    if (secretPath === undefined) {
      return false;
    }

    publicKeyPath = publicPath.trim();
    secretKeyPath = secretPath.trim();
  }

  const fieldDefault = current.field.trim() || 'value';
  const fieldInput = await vscode.window.showInputBox({
    title: 'Configure Langfuse Vault — Secret field',
    prompt: 'Field name inside split Vault secrets (combined secrets use public_key/secret_key)',
    value: fieldDefault,
    ignoreFocusOut: true,
    validateInput: value => (value.trim() ? undefined : 'Field name is required'),
  });
  if (fieldInput === undefined) {
    return false;
  }

  const saved: VaultCredentialSettings = {
    cli: cli.trim(),
    env: env.trim(),
    path,
    publicKeyPath,
    secretKeyPath,
    field: fieldInput.trim() || 'value',
  };

  await saveVaultCredentialSettings(saved);
  void vscode.window.showInformationMessage('Langfuse Vault settings saved.');
  return isVaultCredentialSettingsComplete(saved);
}

/** Reads Vault CLI settings from VS Code configuration. */
export function readVaultCredentialSettingsFromConfig(): VaultCredentialSettings {
  const config = vscode.workspace.getConfiguration('langfuse');
  return {
    cli: config.get<string>('vault.cli', '').trim(),
    env: config.get<string>('vault.env', '').trim(),
    path: config.get<string>('vault.path', '').trim(),
    publicKeyPath: config.get<string>('vault.publicKeyPath', '').trim(),
    secretKeyPath: config.get<string>('vault.secretKeyPath', '').trim(),
    field: config.get<string>('vault.field', 'value').trim() || 'value',
  };
}
