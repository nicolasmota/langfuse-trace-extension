import * as vscode from 'vscode';
import {
  type VaultCredentialSettings,
  type VaultOutputFormat,
  defaultVaultCredentialSettings,
  isVaultCredentialSettingsComplete,
} from './vault-credentials';

export { isVaultCredentialSettingsComplete, type VaultCredentialSettings };

type VaultIntegrationMode = 'hashicorp' | 'custom';

/**
 * Persists Vault CLI settings to the user's global VS Code configuration.
 */
export async function saveVaultCredentialSettings(settings: VaultCredentialSettings): Promise<void> {
  const config = vscode.workspace.getConfiguration('langfuse');
  const target = vscode.ConfigurationTarget.Global;
  await Promise.all([
    config.update('vault.cli', settings.cli, target),
    config.update('vault.mount', settings.mount, target),
    config.update('vault.env', settings.env, target),
    config.update('vault.commandTemplate', settings.commandTemplate, target),
    config.update('vault.outputFormat', settings.outputFormat, target),
    config.update('vault.path', settings.path, target),
    config.update('vault.publicKeyPath', settings.publicKeyPath, target),
    config.update('vault.secretKeyPath', settings.secretKeyPath, target),
    config.update('vault.field', settings.field, target),
  ]);
}

type VaultSecretLayout = 'combined' | 'split';

function integrationModeFromSettings(settings: VaultCredentialSettings): VaultIntegrationMode {
  return settings.commandTemplate.trim() ? 'custom' : 'hashicorp';
}

async function promptVaultSecretLayout(current: VaultCredentialSettings): Promise<VaultSecretLayout | undefined> {
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
  return layoutPick?.layout ?? defaultLayout;
}

async function promptVaultPaths(
  current: VaultCredentialSettings,
  layout: VaultSecretLayout,
): Promise<Pick<VaultCredentialSettings, 'path' | 'publicKeyPath' | 'secretKeyPath'> | undefined> {
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
      return undefined;
    }
    return { path: combinedPath.trim(), publicKeyPath: '', secretKeyPath: '' };
  }

  const publicPath = await vscode.window.showInputBox({
    title: 'Configure Langfuse Vault — Public key path',
    prompt: 'Vault KV path for the Langfuse public key',
    placeHolder: 'e.g. apps/langfuse/public-key',
    value: current.publicKeyPath,
    ignoreFocusOut: true,
    validateInput: value => (value.trim() ? undefined : 'Public key path is required'),
  });
  if (publicPath === undefined) {
    return undefined;
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
    return undefined;
  }

  return {
    path: '',
    publicKeyPath: publicPath.trim(),
    secretKeyPath: secretPath.trim(),
  };
}

/**
 * Guides the user through configuring Vault CLI settings via input prompts.
 * Returns true when settings were saved and are complete enough for sync.
 */
export async function configureVaultCredentialSettings(
  existing?: VaultCredentialSettings,
): Promise<boolean> {
  const current = existing ?? readVaultCredentialSettingsFromConfig();
  const defaults = defaultVaultCredentialSettings();

  const modePick = await vscode.window.showQuickPick(
    [
      {
        label: 'HashiCorp Vault CLI',
        description: 'Default: vault kv get -mount <mount> -format=json <path>',
        mode: 'hashicorp' as const,
      },
      {
        label: 'Custom command template',
        description: 'Use placeholders {cli}, {env}, {mount}, {path}',
        mode: 'custom' as const,
      },
    ],
    {
      title: 'Configure Langfuse Vault — Integration',
      placeHolder: 'How should secrets be fetched?',
      ignoreFocusOut: true,
    },
  );
  if (!modePick) {
    return false;
  }
  const mode = modePick.mode ?? integrationModeFromSettings(current);

  const cliDefault = current.cli || defaults.cli;
  const cli = await vscode.window.showInputBox({
    title: 'Configure Langfuse Vault — CLI',
    prompt: 'Executable used to fetch secrets (must be on PATH or an absolute path)',
    placeHolder: 'vault',
    value: cliDefault,
    ignoreFocusOut: true,
    validateInput: value => (value.trim() ? undefined : 'Vault CLI is required'),
  });
  if (cli === undefined) {
    return false;
  }

  let mount = current.mount || defaults.mount;
  let env = current.env;
  let commandTemplate = '';
  let outputFormat: VaultOutputFormat = 'json';

  if (mode === 'hashicorp') {
    const mountInput = await vscode.window.showInputBox({
      title: 'Configure Langfuse Vault — KV mount',
      prompt: 'KV secrets engine mount used by vault kv get -mount',
      value: mount,
      ignoreFocusOut: true,
      validateInput: value => (value.trim() ? undefined : 'KV mount is required'),
    });
    if (mountInput === undefined) {
      return false;
    }
    mount = mountInput.trim();
  } else {
    const templateInput = await vscode.window.showInputBox({
      title: 'Configure Langfuse Vault — Command template',
      prompt: 'Shell command with {cli}, {env}, {mount}, and {path} placeholders',
      placeHolder: '{cli} secrets get --env {env} {path}',
      value: current.commandTemplate,
      ignoreFocusOut: true,
      validateInput: value => (value.trim() ? undefined : 'Command template is required'),
    });
    if (templateInput === undefined) {
      return false;
    }
    commandTemplate = templateInput.trim();
    outputFormat = 'auto';

    if (commandTemplate.includes('{env}')) {
      const envInput = await vscode.window.showInputBox({
        title: 'Configure Langfuse Vault — Environment',
        prompt: 'Value substituted into {env} in the command template',
        placeHolder: 'e.g. production',
        value: env,
        ignoreFocusOut: true,
        validateInput: value => (value.trim() ? undefined : 'Environment is required for this template'),
      });
      if (envInput === undefined) {
        return false;
      }
      env = envInput.trim();
    }

    if (commandTemplate.includes('{mount}')) {
      const mountInput = await vscode.window.showInputBox({
        title: 'Configure Langfuse Vault — KV mount',
        prompt: 'Value substituted into {mount} in the command template',
        value: mount,
        ignoreFocusOut: true,
        validateInput: value => (value.trim() ? undefined : 'Mount is required for this template'),
      });
      if (mountInput === undefined) {
        return false;
      }
      mount = mountInput.trim();
    }
  }

  const layout = await promptVaultSecretLayout(current);
  if (!layout) {
    return false;
  }

  const paths = await promptVaultPaths(current, layout);
  if (!paths) {
    return false;
  }

  const fieldDefault = current.field.trim() || defaults.field;
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
    mount,
    env,
    commandTemplate,
    outputFormat,
    field: fieldInput.trim() || defaults.field,
    ...paths,
  };

  await saveVaultCredentialSettings(saved);
  void vscode.window.showInformationMessage('Langfuse Vault settings saved.');
  return isVaultCredentialSettingsComplete(saved);
}

/** Reads Vault CLI settings from VS Code configuration. */
export function readVaultCredentialSettingsFromConfig(): VaultCredentialSettings {
  const config = vscode.workspace.getConfiguration('langfuse');
  const defaults = defaultVaultCredentialSettings();
  const commandTemplate = config.get<string>('vault.commandTemplate', '').trim();
  const outputFormat = config.get<VaultOutputFormat>('vault.outputFormat', defaults.outputFormat);
  return {
    cli: config.get<string>('vault.cli', defaults.cli).trim() || defaults.cli,
    mount: config.get<string>('vault.mount', defaults.mount).trim() || defaults.mount,
    env: config.get<string>('vault.env', '').trim(),
    commandTemplate,
    outputFormat: commandTemplate ? (outputFormat || 'auto') : 'json',
    path: config.get<string>('vault.path', '').trim(),
    publicKeyPath: config.get<string>('vault.publicKeyPath', '').trim(),
    secretKeyPath: config.get<string>('vault.secretKeyPath', '').trim(),
    field: config.get<string>('vault.field', defaults.field).trim() || defaults.field,
  };
}
