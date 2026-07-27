import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const DEFAULT_VAULT_CLI = 'vault';
const DEFAULT_VAULT_MOUNT = 'secret';

const PUBLIC_KEY_ALIASES = ['public_key', 'publickey', 'langfuse_public_key', 'pk', 'value'];
const SECRET_KEY_ALIASES = ['secret_key', 'secretkey', 'langfuse_secret_key', 'sk', 'value'];
const HOST_ALIASES = ['host', 'langfuse_host', 'base_url', 'baseurl', 'url'];

export type VaultOutputFormat = 'auto' | 'json' | 'keyvalue';
export type VaultSecretRunner = (settings: VaultCredentialSettings, vaultPath: string) => Promise<string>;

export interface VaultCredentialFetchOptions extends VaultCredentialSettings {
  runVault?: VaultSecretRunner;
}

export interface VaultCredentialSettings {
  cli: string;
  mount: string;
  env: string;
  commandTemplate: string;
  outputFormat: VaultOutputFormat;
  path: string;
  publicKeyPath: string;
  secretKeyPath: string;
  field: string;
}

/**
 * Returns true when Vault sync has enough settings to fetch credentials.
 */
export function isVaultCredentialSettingsComplete(settings: VaultCredentialSettings): boolean {
  if (!settings.cli.trim()) {
    return false;
  }
  if (settings.commandTemplate.trim()) {
    const template = settings.commandTemplate;
    if (template.includes('{env}') && !settings.env.trim()) {
      return false;
    }
    if (template.includes('{mount}') && !settings.mount.trim()) {
      return false;
    }
  }
  if (settings.path.trim()) {
    return true;
  }
  return Boolean(settings.publicKeyPath.trim() && settings.secretKeyPath.trim());
}

/**
 * Returns default Vault credential settings for HashiCorp Vault CLI usage.
 */
export function defaultVaultCredentialSettings(): VaultCredentialSettings {
  return {
    cli: DEFAULT_VAULT_CLI,
    mount: DEFAULT_VAULT_MOUNT,
    env: '',
    commandTemplate: '',
    outputFormat: 'json',
    path: '',
    publicKeyPath: '',
    secretKeyPath: '',
    field: 'value',
  };
}

/**
 * Substitutes `{cli}`, `{env}`, `{mount}`, and `{path}` placeholders in a command template.
 */
export function substituteVaultCommandTemplate(
  template: string,
  vars: { cli: string; env: string; mount: string; path: string },
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    switch (key) {
      case 'cli':
        return vars.cli;
      case 'env':
        return vars.env;
      case 'mount':
        return vars.mount;
      case 'path':
        return vars.path;
      default:
        return '';
    }
  }).trim();
}

/**
 * Parses Vault CLI KV get stdout (`key:value` lines) into a string map.
 * Values may contain colons; only the first colon splits key from value.
 */
export function parseVaultKvOutput(stdout: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const sep = line.indexOf(':');
    if (sep <= 0) {
      continue;
    }
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * Parses HashiCorp Vault KV JSON output into a flat string map.
 */
export function parseVaultJsonOutput(stdout: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('Vault output was not valid JSON.');
  }
  const container = parsed as { data?: { data?: Record<string, unknown> } | Record<string, unknown> };
  const nested = container.data;
  const data = (nested && typeof nested === 'object' && 'data' in nested
    ? nested.data
    : nested) as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Vault JSON output did not contain a data object.');
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      result[key] = value;
    } else if (value != null) {
      result[key] = String(value);
    }
  }
  return result;
}

/**
 * Parses Vault secret output using the configured format, with auto-detection when enabled.
 */
export function parseVaultSecretOutput(stdout: string, format: VaultOutputFormat): Record<string, string> {
  const trimmed = stdout.trim();
  const useJson = format === 'json' || (format === 'auto' && trimmed.startsWith('{'));
  if (useJson) {
    return parseVaultJsonOutput(trimmed);
  }
  return parseVaultKvOutput(stdout);
}

function pickAlias(map: Record<string, string>, aliases: string[]): string | undefined {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  for (const alias of aliases) {
    const value = lower.get(alias);
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Reads a single credential from a Vault map using an explicit field, aliases,
 * or the sole entry when the secret has only one key.
 */
export function readSingleVaultSecretValue(
  map: Record<string, string>,
  field: string,
  aliases: string[],
): string {
  const preferred = field.trim().toLowerCase();
  if (preferred) {
    const fromField = pickAlias(map, [preferred]);
    if (fromField) {
      return fromField;
    }
  }
  const fromAlias = pickAlias(map, aliases);
  if (fromAlias) {
    return fromAlias;
  }
  const entries = Object.entries(map).filter(([, v]) => v.trim());
  if (entries.length === 1) {
    return entries[0][1].trim();
  }
  const keys = Object.keys(map).sort().join(', ') || '(none)';
  throw new Error(`Vault secret did not contain a usable credential field (found keys: ${keys}).`);
}

/**
 * Extracts Langfuse connection fields from a combined Vault KV map.
 * Requires public + secret keys; host is optional.
 */
export function langfuseCredentialsFromVaultMap(map: Record<string, string>): {
  publicKey: string;
  secretKey: string;
  host?: string;
} {
  const publicKey = pickAlias(map, PUBLIC_KEY_ALIASES.filter(a => a !== 'value'));
  const secretKey = pickAlias(map, SECRET_KEY_ALIASES.filter(a => a !== 'value'));
  if (!publicKey || !secretKey) {
    const keys = Object.keys(map).sort().join(', ') || '(none)';
    throw new Error(
      `Vault secret is missing public_key/secret_key (found keys: ${keys}). `
      + 'Store entries named public_key and secret_key (optional host), '
      + 'or configure langfuse.vault.publicKeyPath and langfuse.vault.secretKeyPath.',
    );
  }
  return {
    publicKey,
    secretKey,
    host: pickAlias(map, HOST_ALIASES),
  };
}

/** Builds a PATH that includes common user-local bin directories. */
export function pathWithExtraBinDirs(existingPath = process.env.PATH ?? ''): string {
  const home = os.homedir();
  const extras = [
    path.join(home, '.bin'),
    path.join(home, 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const parts = existingPath.split(path.delimiter).filter(Boolean);
  for (const extra of extras) {
    if (!parts.includes(extra)) {
      parts.push(extra);
    }
  }
  return parts.join(path.delimiter);
}

function vaultExecEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: pathWithExtraBinDirs(),
  };
}

function formatVaultExecError(cli: string, err: NodeJS.ErrnoException & { stderr?: string; stdout?: string }): Error {
  if (err.code === 'ENOENT') {
    return new Error(
      `Vault CLI "${cli}" not found. Install it or set langfuse.vault.cli to an executable on your PATH.`,
    );
  }
  const detail = [err.stderr, err.stdout, err.message]
    .filter(Boolean)
    .join('\n')
    .trim();
  return new Error(detail || 'Vault credential fetch failed');
}

/** Builds argv for the default HashiCorp Vault CLI invocation. */
export function buildHashicorpVaultArgs(mount: string, vaultPath: string): string[] {
  return ['kv', 'get', '-mount', mount, '-format', 'json', vaultPath];
}

/** Default runner for HashiCorp Vault CLI (`vault kv get -mount … -format=json`). */
export async function runHashicorpVaultGet(
  settings: VaultCredentialSettings,
  vaultPath: string,
): Promise<string> {
  const cli = settings.cli.trim() || DEFAULT_VAULT_CLI;
  const mount = settings.mount.trim() || DEFAULT_VAULT_MOUNT;
  try {
    const { stdout } = await execFileAsync(cli, buildHashicorpVaultArgs(mount, vaultPath), {
      encoding: 'utf8',
      timeout: 60_000,
      env: vaultExecEnv(),
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    throw formatVaultExecError(cli, err as NodeJS.ErrnoException & { stderr?: string; stdout?: string });
  }
}

/** Runs a custom shell command built from `langfuse.vault.commandTemplate`. */
export async function runCustomVaultCommand(
  settings: VaultCredentialSettings,
  vaultPath: string,
): Promise<string> {
  const cli = settings.cli.trim();
  const command = substituteVaultCommandTemplate(settings.commandTemplate.trim(), {
    cli,
    env: settings.env.trim(),
    mount: settings.mount.trim() || DEFAULT_VAULT_MOUNT,
    path: vaultPath,
  });
  if (!command) {
    throw new Error('langfuse.vault.commandTemplate produced an empty command.');
  }
  try {
    const { stdout } = await execAsync(command, {
      encoding: 'utf8',
      timeout: 60_000,
      env: vaultExecEnv(),
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    throw formatVaultExecError(cli, err as NodeJS.ErrnoException & { stderr?: string; stdout?: string });
  }
}

/** Resolves the Vault secret runner for the configured settings. */
export function resolveVaultSecretRunner(settings: VaultCredentialSettings): VaultSecretRunner {
  if (settings.commandTemplate.trim()) {
    return runCustomVaultCommand;
  }
  return runHashicorpVaultGet;
}

async function getVaultMap(
  runVault: VaultSecretRunner,
  settings: VaultCredentialSettings,
  vaultPath: string,
): Promise<Record<string, string>> {
  const stdout = await runVault(settings, vaultPath);
  return parseVaultSecretOutput(stdout, settings.outputFormat);
}

/**
 * Fetches Langfuse credentials from Vault.
 *
 * Default: HashiCorp Vault CLI (`vault kv get -mount <mount> -format=json <path>`).
 * Custom: set `commandTemplate` with `{cli}`, `{env}`, `{mount}`, and `{path}` placeholders.
 */
export async function fetchLangfuseCredentialsFromVault(
  options: VaultCredentialFetchOptions,
): Promise<{ publicKey: string; secretKey: string; host?: string }> {
  const settings: VaultCredentialSettings = {
    ...defaultVaultCredentialSettings(),
    ...options,
    cli: options.cli.trim() || DEFAULT_VAULT_CLI,
    mount: options.mount.trim() || DEFAULT_VAULT_MOUNT,
    field: options.field?.trim() || 'value',
    outputFormat: options.outputFormat ?? (options.commandTemplate.trim() ? 'auto' : 'json'),
  };
  const combinedPath = settings.path.trim();
  const publicKeyPath = settings.publicKeyPath.trim();
  const secretKeyPath = settings.secretKeyPath.trim();

  if (!settings.cli) {
    throw new Error('Configure langfuse.vault.cli before syncing credentials.');
  }
  if (settings.commandTemplate.trim()) {
    const template = settings.commandTemplate;
    if (template.includes('{env}') && !settings.env.trim()) {
      throw new Error('Configure langfuse.vault.env because commandTemplate uses {env}.');
    }
    if (template.includes('{mount}') && !settings.mount.trim()) {
      throw new Error('Configure langfuse.vault.mount because commandTemplate uses {mount}.');
    }
  }
  if (!combinedPath && !(publicKeyPath && secretKeyPath)) {
    throw new Error(
      'Configure langfuse.vault.path (combined secret) or both '
      + 'langfuse.vault.publicKeyPath and langfuse.vault.secretKeyPath.',
    );
  }

  const runVault = options.runVault ?? resolveVaultSecretRunner(settings);

  if (publicKeyPath && secretKeyPath) {
    const [publicMap, secretMap] = await Promise.all([
      getVaultMap(runVault, settings, publicKeyPath),
      getVaultMap(runVault, settings, secretKeyPath),
    ]);
    return {
      publicKey: readSingleVaultSecretValue(publicMap, settings.field, PUBLIC_KEY_ALIASES),
      secretKey: readSingleVaultSecretValue(secretMap, settings.field, SECRET_KEY_ALIASES),
    };
  }

  return langfuseCredentialsFromVaultMap(await getVaultMap(runVault, settings, combinedPath));
}
