import * as https from 'https';
import * as http from 'http';

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
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
}

export interface LangfuseSession {
  id: string;
  createdAt: string;
  projectId?: string;
  environment?: string;
}

export interface LangfuseObservation {
  id: string;
  traceId: string;
  parentObservationId?: string;
  name?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: string;
  statusMessage?: string;
  model?: string;
  modelParameters?: Record<string, unknown>;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
    unit?: string;
  };
  calculatedInputCost?: number;
  calculatedOutputCost?: number;
  calculatedTotalCost?: number;
  latency?: number;
}

const DEFAULT_HOST = 'http://127.0.0.1:3000';
const DEFAULT_PUBLIC_KEY = 'pk-lf-local-dev';
const DEFAULT_SECRET_KEY = 'sk-lf-local-dev';

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
  private readonly _host: string;
  private readonly _authHeader: string;

  constructor(config: LangfuseConfig) {
    this._host = config.host.replace(/\/$/, '');
    const credentials = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64');
    this._authHeader = `Basic ${credentials}`;
  }

  /**
   * Fetches traces associated with a Langfuse session using the native
   * `sessionId` query parameter supported by the REST API.
   */
  async fetchSessionTraces(sessionId: string): Promise<LangfuseTrace[]> {
    const data = await this._get(`/api/public/traces?sessionId=${encodeURIComponent(sessionId)}`);
    return (data?.data ?? []) as LangfuseTrace[];
  }

  /**
   * Fetches the most recent Langfuse sessions for the configured project.
   * Results are ordered newest-first by the API.
   */
  async fetchRecentSessions(limit = 10): Promise<LangfuseSession[]> {
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const data = await this._get(`/api/public/sessions?limit=${safeLimit}&page=1`);
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
    const data = await this._get(`/api/public/traces/${encodeURIComponent(traceId)}`);
    return data as unknown as LangfuseTrace & { observations: LangfuseObservation[] };
  }

  private _get(path: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const url = `${this._host}${path}`;
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
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Langfuse request timed out after 10s'));
      });
      req.end();
    });
  }
}
