// ---------------------------------------------------------------------------
// mem9 cloud memory API client
// https://api.mem9.ai
// ---------------------------------------------------------------------------

const MEM9_API_BASE = "https://api.mem9.ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Mem9Memory {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  relevance_score?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Mem9SearchResult {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  relevance_score: number;
}

export interface Mem9StoreOptions {
  /** The text content to store as a memory */
  content: string;
  /** User ID to associate the memory with */
  userId?: string;
  /** Session ID for grouping */
  sessionId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface Mem9SearchOptions {
  /** Search query */
  query: string;
  /** User ID to scope search */
  userId?: string;
  /** Maximum results (default 5) */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig(): { apiKey: string; orgId: string } | null {
  const apiKey = process.env.MEM9_API_KEY;
  const orgId = process.env.MEM9_ORG_ID;

  if (!apiKey || !orgId) {
    return null;
  }

  return { apiKey, orgId };
}

/** Check if mem9 is configured and available */
export function mem9Enabled(): boolean {
  return getConfig() !== null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function mem9Fetch(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const config = getConfig();
  if (!config) {
    throw new Error("mem9 not configured: MEM9_API_KEY and MEM9_ORG_ID required");
  }

  const url = `${MEM9_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "X-Org-Id": config.orgId,
  };

  const response = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `mem9 API error: ${response.status} ${response.statusText} — ${text}`,
    );
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * Store a memory in mem9 cloud.
 */
export async function mem9Store(opts: Mem9StoreOptions): Promise<Mem9Memory> {
  const body: Record<string, unknown> = {
    content: opts.content,
  };

  if (opts.userId) body.user_id = opts.userId;
  if (opts.sessionId) body.session_id = opts.sessionId;
  if (opts.metadata) body.metadata = opts.metadata;

  const result = await mem9Fetch("/v1/memories", {
    method: "POST",
    body,
  });

  console.log(`[mem9] Stored memory (${opts.content.length} chars)`);
  return result as Mem9Memory;
}

/**
 * Search memories in mem9 cloud.
 */
export async function mem9Search(
  opts: Mem9SearchOptions,
): Promise<Mem9SearchResult[]> {
  const body: Record<string, unknown> = {
    query: opts.query,
    limit: opts.limit ?? 5,
  };

  if (opts.userId) body.user_id = opts.userId;

  const result = (await mem9Fetch("/v1/memories/search", {
    method: "POST",
    body,
  })) as { results?: Mem9SearchResult[]; memories?: Mem9SearchResult[] };

  // The API might return results under different keys
  const memories = result.results || result.memories || [];
  console.log(
    `[mem9] Search "${opts.query}" → ${memories.length} results`,
  );
  return memories;
}

/**
 * Store a conversation turn in mem9 for automatic memory extraction.
 * This is the primary way to build up memories — send conversation messages
 * and mem9 extracts and stores relevant facts automatically.
 */
export async function mem9StoreConversation(opts: {
  messages: Array<{ role: string; content: string }>;
  userId?: string;
  sessionId?: string;
}): Promise<void> {
  const body: Record<string, unknown> = {
    messages: opts.messages,
  };

  if (opts.userId) body.user_id = opts.userId;
  if (opts.sessionId) body.session_id = opts.sessionId;

  try {
    await mem9Fetch("/v1/memories/conversations", {
      method: "POST",
      body,
    });
    console.log(`[mem9] Stored conversation (${opts.messages.length} messages)`);
  } catch (err) {
    // Conversation endpoint might not exist in all versions — fall back to
    // storing the conversation as a single memory
    console.warn(`[mem9] Conversation endpoint failed, falling back to store:`, err);

    const content = opts.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    await mem9Store({
      content,
      userId: opts.userId,
      sessionId: opts.sessionId,
      metadata: { type: "conversation" },
    });
  }
}
