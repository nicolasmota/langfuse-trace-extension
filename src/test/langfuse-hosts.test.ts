import { describe, it, expect } from 'vitest';
import {
  isRetryableLangfuseNetworkError,
  langfuseHostCandidates,
  normalizeLangfuseHost,
} from '../langfuse-hosts.js';

describe('normalizeLangfuseHost', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeLangfuseHost('  https://langfuse.example.com/  '))
      .toBe('https://langfuse.example.com');
  });
});

describe('langfuseHostCandidates', () => {
  it('returns only the configured host', () => {
    expect(langfuseHostCandidates('https://langfuse.example.com/'))
      .toEqual(['https://langfuse.example.com']);
  });
});

describe('isRetryableLangfuseNetworkError', () => {
  it('detects transient network failures', () => {
    expect(isRetryableLangfuseNetworkError('Langfuse request failed: read ECONNRESET')).toBe(true);
    expect(isRetryableLangfuseNetworkError('Langfuse request timed out after 30s')).toBe(true);
    expect(isRetryableLangfuseNetworkError('Langfuse API error 401: Unauthorized')).toBe(false);
  });
});
