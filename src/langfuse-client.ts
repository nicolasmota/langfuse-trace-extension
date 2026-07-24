import * as https from 'https';
import * as http from 'http';
import { isRetryableLangfuseNetworkError, langfuseHostCandidates, normalizeLangfuseHost } from './langfuse-hosts.js';

export interface LangfuseConfig {
  host: string;
  publicKey: string;
  secretKey: string;
}

export interface LangfuseTrace {
  id: string;
  name?: string;
  timestamp?: string;
  sessionId?: string;
  userId?: string;
  release?: string;
  version?: string;
  environment?: string;
  input?: unknown;
  output?: unknown;
  /**
   * Langfuse stores metadata as a JSON-encoded string when set via the Python
   * OTel SDK. The REST API may return either a raw string or a parsed object
   * depending on the Langfuse version.
   */
  metadata?: string | Record<string, unknown>;
  tags?: string[];
  latency?: number;
  totalCost?: number;
  htmlPath?: string;
  public?: boolean;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  scores?: LangfuseScore[];
  observations?: LangfuseObservation[];
}

export interface LangfuseSession {
  id: string;
  createdAt: string;
  projectId?: string;
  environment?: string;
  traces?: LangfuseTrace[];
}

export interface LangfuseScore {
  id: string;
  name: string;
  traceId?: string;
  observationId?: string | null;
  value?: number | null;
  stringValue?: string | null;
  dataType?: string;
  comment?: string | null;
  source?: string;
  timestamp?: string;
}

export interface LangfuseObservation {
  id: string;
  traceId: string;
  parentObservationId?: string;
  name?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
  completionStartTime?: string;
  timeToFirstToken?: number;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: string;
  statusMessage?: string;
  version?: string;
  environment?: string;
  model?: string;
  modelParameters?: Record<string, unknown>;
  promptId?: string;
  promptName?: string;
  promptVersion?: number;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    unit?: string;
  };
  usageDetails?: Record<string, number>;
  calculatedInputCost?: number;
  calculatedOutputCost?: number;
  calculatedTotalCost?: number;
  /** Prefer over deprecated calculatedTotalCost when present. */
  totalCost?: number;
  /** Per-metric USD costs; `total` key is the aggregated cost when present. */
  costDetails?: Record<string, number>;
  latency?: number;
}

const DEFAULT_HOST = 'http://127.0.0.1:3000';
const DEFAULT_PUBLIC_KEY = 'pk-lf-local-dev';
const DEFAULT_SECRET_KEY = 'sk-lf-local-dev';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const TRACE_LIST_LOOKBACK_DAYS = 30;

/** Returns default Langfuse configuration for local development. */
export function defaultLangfuseConfig(): LangfuseConfig {
  return {
    host: DEFAULT_HOST,
    publicKey: DEFAULT_PUBLIC_KEY,
    secretKey: DEFAULT_SECRET_KEY,
  };
}

/** Builds a fully populated Langfuse config from any partial source, trimming and falling back to defaults. */
export function buildLangfuseConfig(source: {
  host?: string | null;
  publicKey?: string | null;
  secretKey?: string | null;
}): LangfuseConfig {
  const defaults = defaultLangfuseConfig();
  return {
    host: source.host?.trim() || defaults.host,
    publicKey: source.publicKey?.trim() || defaults.publicKey,
    secretKey: source.secretKey?.trim() || defaults.secretKey,
  };
}

/** Lightweight Langfuse REST client that avoids adding the full SDK as a dependency. */
export class LangfuseClient {
  private readonly _hosts: string[];
  private readonly _authHeader: string;
  private _activeHostIndex = 0;

  constructor(config: LangfuseConfig) {
    this._hosts = langfuseHostCandidates(config.host);
    const credentials = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64');
    this._authHeader = `Basic ${credentials}`;
  }

  /** Returns the host that last served a successful request. */
  get activeHost(): string {
    return this._hosts[this._activeHostIndex] ?? normalizeLangfuseHost(this._hosts[0] ?? DEFAULT_HOST);
  }

  /**
   * Fetches traces for a session, preferring the faster sessions endpoint and falling
   * back to the legacy traces list with a bounded date range.
   */
  async fetchSessionTraces(sessionId: string): Promise<LangfuseTrace[]> {
    try {
      const session = await this._getWithFallback(
        `/api/public/sessions/${encodeURIComponent(sessionId)}`,
      ) as unknown as LangfuseSession;
      if (Array.isArray(session.traces) && session.traces.length > 0) {
        return session.traces;
      }
    } catch {
      // Fall back to the traces list endpoint below.
    }

    const fromTimestamp = new Date(
      Date.now() - TRACE_LIST_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const data = await this._getWithFallback(
      `/api/public/traces?sessionId=${encodeURIComponent(sessionId)}`
      + `&limit=50&fromTimestamp=${encodeURIComponent(fromTimestamp)}`,
    );
    return (data?.data ?? []) as LangfuseTrace[];
  }

  /**
   * Fetches the most recent Langfuse sessions for the configured project.
   * Results are ordered newest-first by the API.
   */
  async fetchRecentSessions(limit = 10): Promise<LangfuseSession[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const data = await this._getWithFallback(`/api/public/sessions?limit=${safeLimit}&page=1`);
    return (data?.data ?? []) as LangfuseSession[];
  }

  /**
   * Fetches a single trace by ID including its full observations list.
   *
   * Uses `GET /api/public/traces/{traceId}` instead of the observations list
   * endpoint because the single-trace endpoint returns ALL observations
   * embedded in the response (matching what the Langfuse web UI shows).
   * The observations list endpoint (`/api/public/observations?traceId=...`)
   * only returns observations recorded directly against that trace ID and
   * misses observations from sub-agents recorded under different trace IDs
   * that Langfuse stitches together internally.
   */
  async fetchFullTrace(traceId: string): Promise<LangfuseTrace & { observations: LangfuseObservation[] }> {
    const data = await this._getWithFallback(`/api/public/traces/${encodeURIComponent(traceId)}`);
    return data as unknown as LangfuseTrace & { observations: LangfuseObservation[] };
  }

  private async _getWithFallback(path: string): Promise<Record<string, unknown>> {
    let lastError: Error | undefined;

    for (let hostIndex = 0; hostIndex < this._hosts.length; hostIndex++) {
      this._activeHostIndex = hostIndex;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await this._get(path);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          lastError = error;
          const retryable = isRetryableLangfuseNetworkError(error.message);
          if (!retryable || attempt === 1) {
            break;
          }
        }
      }
    }

    throw lastError ?? new Error('Langfuse request failed');
  }

  private _get(path: string): Promise<Record<string, unknown>> {
    const host = this._hosts[this._activeHostIndex];
    return new Promise((resolve, reject) => {
      const url = `${host}${path}`;
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'Authorization': this._authHeader,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      };

      const transport = isHttps ? https : http;
      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Langfuse API error ${res.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as Record<string, unknown>);
          } catch {
            reject(new Error(`Failed to parse Langfuse response: ${body.slice(0, 200)}`));
          }
        });
      });

      req.on('error', (err: Error) => reject(new Error(`Langfuse request failed: ${err.message}`)));
      req.setTimeout(DEFAULT_REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Langfuse request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS / 1000}s`));
      });
      req.end();
    });
  }
}
