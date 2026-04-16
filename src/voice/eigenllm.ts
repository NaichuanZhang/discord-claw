/**
 * Eigen LLM client for voice agent — OpenAI-compatible streaming.
 *
 * Provides a streaming interface that emits text deltas, matching
 * the pattern used by the Anthropic streaming path in agent.ts.
 *
 * Usage: set VOICE_MODEL=eigen:qwen3-8b-fp8 (or any Eigen model)
 */

import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let eigenClient: OpenAI | null = null;

function getEigenClient(): OpenAI {
  if (!eigenClient) {
    const apiKey = process.env.EIGENAI_API_KEY;
    if (!apiKey) {
      throw new Error("EIGENAI_API_KEY environment variable is not set");
    }
    eigenClient = new OpenAI({
      apiKey,
      baseURL: "https://api-web.eigenai.com/api/v1",
    });
  }
  return eigenClient;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EigenStreamOptions {
  model: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxTokens: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

// ---------------------------------------------------------------------------
// Streaming completion
// ---------------------------------------------------------------------------

/**
 * Stream a completion from Eigen LLM, calling onDelta for each text chunk.
 * Returns the full response text when complete.
 *
 * For Qwen3 models, prepends /no_think to the first user message to
 * disable thinking mode and reduce latency.
 */
export async function eigenStreamCompletion(opts: EigenStreamOptions): Promise<string> {
  const client = getEigenClient();

  // Build OpenAI-format messages
  const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: opts.systemPrompt },
  ];

  for (let i = 0; i < opts.messages.length; i++) {
    const msg = opts.messages[i];
    if (msg.role === "user" && i === opts.messages.length - 1 && opts.model.startsWith("qwen3")) {
      // Add /no_think prefix to the last user message for Qwen3 models
      openaiMessages.push({ role: "user", content: `/no_think ${msg.content}` });
    } else {
      openaiMessages.push({ role: msg.role, content: msg.content });
    }
  }

  const stream = await client.chat.completions.create(
    {
      model: opts.model,
      messages: openaiMessages,
      max_tokens: opts.maxTokens,
      stream: true,
    },
    {
      signal: opts.signal,
    },
  );

  let fullText = "";

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      fullText += delta.content;
      opts.onDelta(delta.content);
    }
  }

  return fullText;
}
