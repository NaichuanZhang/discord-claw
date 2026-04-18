// ---------------------------------------------------------------------------
// Shared Anthropic client — singleton used by all modules
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic client configured from environment variables.
 * Reuses a single instance across agent, voice agent, and reflection daemon.
 *
 * Configuration:
 * - maxRetries: 3 (default was 2) — more resilient to transient failures
 * - timeout: 5 minutes (default was 10 min) — fail faster for Discord UX
 */
export const anthropicClient = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY,
  maxRetries: 3,
  timeout: 5 * 60 * 1000, // 5 minutes
});
