import { buildLangfuseConfig, type LangfuseConfig } from './langfuse-client.js';

/** Reads Langfuse connection settings from process environment variables. */
export function readLangfuseConfigFromEnv(): LangfuseConfig {
  return buildLangfuseConfig({
    host: process.env.LANGFUSE_HOST,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
  });
}
