/**
 * Normalizes a Langfuse base URL by trimming whitespace and trailing slashes.
 */
export function normalizeLangfuseHost(host: string): string {
  return host.trim().replace(/\/$/, '');
}

/**
 * Builds an ordered list of Langfuse hosts to try.
 * Today this is just the configured host; callers may retry on transient errors.
 */
export function langfuseHostCandidates(configuredHost: string): string[] {
  return [normalizeLangfuseHost(configuredHost)];
}

/**
 * Returns true when a Langfuse HTTP error is likely transient and worth retrying
 * on the same host or a fallback host.
 */
export function isRetryableLangfuseNetworkError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('econnreset')
    || lower.includes('etimedout')
    || lower.includes('timed out')
    || lower.includes('socket hang up')
    || lower.includes('connection reset')
    || lower.includes('network');
}
