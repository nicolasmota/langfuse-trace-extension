import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

const PUBLIC_KEY_ALIASES = ['public_key', 'publickey', 'langfuse_public_key', 'pk', 'value'];
const SECRET_KEY_ALIASES = ['secret_key', 'secretkey', 'langfuse_secret_key', 'sk', 'value'];
const HOST_ALIASES = ['host', 'langfuse_host', 'base_url', 'baseurl', 'url'];

export type VaultKvRunner = (cli: string, args: string[]) => Promise<string>;

export interface VaultCredentialFetchOptions {
  cli: string;
  env: string;
  /** Combined secret path with public_key + secret_key (optional host). */
  path?: string;
  /** Split secret path that stores only the public key (field defaults to value). */
  publicKeyPath?: string;
  /** Split secret path that stores only the secret key (field defaults to value). */
  secretKeyPath?: string;
  /** Field name inside split secrets (default: value). */
  field?: string;
  runVault?: VaultKvRunner;
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

/** Default runner that invokes the configured Vault CLI. */
export async function runVaultKvGet(cli: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cli, args, {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PATH: pathWithExtraBinDirs(),
      },
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    if (error.code === 'ENOENT') {
      throw new Error(
        `Vault CLI "${cli}" not found. Install it or set langfuse.vault.cli to an executable on your PATH.`,
      );
    }
    const detail = [error.stderr, error.stdout, error.message]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(detail || 'Vault credential fetch failed');
  }
}

async function getVaultMap(
  runVault: VaultKvRunner,
  cli: string,
  env: string,
  vaultPath: string,
): Promise<Record<string, string>> {
  const stdout = await runVault(cli, ['kv', 'get', '-e', env, vaultPath, '--no-prompt']);
  return parseVaultKvOutput(stdout);
}

/**
 * Fetches Langfuse credentials from Vault via a configured CLI
 * (`<cli> kv get -e <env> <path> --no-prompt`).
 *
 * Supports either a combined secret (`path`) or split secrets
 * (`publicKeyPath` + `secretKeyPath`).
 */
export async function fetchLangfuseCredentialsFromVault(
  options: VaultCredentialFetchOptions,
): Promise<{ publicKey: string; secretKey: string; host?: string }> {
  const cli = options.cli.trim();
  const env = options.env.trim();
  const combinedPath = options.path?.trim() ?? '';
  const publicKeyPath = options.publicKeyPath?.trim() ?? '';
  const secretKeyPath = options.secretKeyPath?.trim() ?? '';
  const field = options.field?.trim() || 'value';

  if (!cli || !env) {
    throw new Error('Configure langfuse.vault.cli and langfuse.vault.env before syncing credentials.');
  }
  if (!combinedPath && !(publicKeyPath && secretKeyPath)) {
    throw new Error(
      'Configure langfuse.vault.path (combined secret) or both '
      + 'langfuse.vault.publicKeyPath and langfuse.vault.secretKeyPath.',
    );
  }

  const runVault = options.runVault ?? runVaultKvGet;

  if (publicKeyPath && secretKeyPath) {
    const [publicMap, secretMap] = await Promise.all([
      getVaultMap(runVault, cli, env, publicKeyPath),
      getVaultMap(runVault, cli, env, secretKeyPath),
    ]);
    return {
      publicKey: readSingleVaultSecretValue(publicMap, field, PUBLIC_KEY_ALIASES),
      secretKey: readSingleVaultSecretValue(secretMap, field, SECRET_KEY_ALIASES),
    };
  }

  return langfuseCredentialsFromVaultMap(await getVaultMap(runVault, cli, env, combinedPath));
}
