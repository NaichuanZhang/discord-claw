import { searchMemory, getMemoryLines } from "./memory.js";
import { mem9Enabled, mem9Search, mem9Store, type Mem9SearchResult } from "./mem9.js";

// ---------------------------------------------------------------------------
// Tool definitions (passed to the Claude agent as available tools)
// ---------------------------------------------------------------------------

export const memoryTools = [
  {
    name: "memory_search",
    description:
      "Search across all memory files for relevant context. Use this before answering questions about prior conversations, decisions, preferences, people, or facts.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: {
          type: "number",
          description: "Maximum results to return (default 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_get",
    description:
      "Read specific lines from a memory file. Use after memory_search to get full context around a result.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the memory file (relative to data/)",
        },
        from: { type: "number", description: "Starting line number (1-based)" },
        lines: {
          type: "number",
          description: "Number of lines to read (default: 50)",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "memory_store",
    description:
      "Store a piece of information in persistent cloud memory (mem9). Use this to remember important facts, user preferences, decisions, or anything worth recalling later. Only available when mem9 is configured.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The information to store as a memory",
        },
        user_id: {
          type: "string",
          description: "Optional Discord user ID to associate this memory with",
        },
      },
      required: ["content"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------

export async function handleMemoryTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "memory_search": {
      const query = input.query as string;
      const maxResults = (input.max_results as number | undefined) ?? 5;
      console.log(`[memory] search: "${query}" (max ${maxResults})`);

      // Always search local FTS5
      const localResults = searchMemory(query, maxResults);

      // Also search mem9 if configured
      let mem9Results: Mem9SearchResult[] = [];
      if (mem9Enabled()) {
        try {
          mem9Results = await mem9Search({
            query,
            limit: maxResults,
          });
        } catch (err) {
          console.error("[memory] mem9 search failed:", err);
          // Continue with local results only
        }
      }

      // Merge results: local first, then mem9 cloud results
      const combined: Array<{
        source: string;
        path?: string;
        content: string;
        startLine?: number;
        endLine?: number;
        score?: number;
        relevance_score?: number;
        mem9_id?: string;
      }> = [];

      for (const r of localResults) {
        combined.push({
          source: "local",
          path: r.path,
          content: r.chunkText,
          startLine: r.startLine,
          endLine: r.endLine,
          score: r.score,
        });
      }

      for (const r of mem9Results) {
        combined.push({
          source: "mem9",
          content: r.content,
          relevance_score: r.relevance_score,
          mem9_id: r.id,
        });
      }

      if (combined.length === 0) {
        return JSON.stringify({ results: [], message: "No matches found." });
      }

      return JSON.stringify({
        results: combined,
        sources: {
          local: localResults.length,
          mem9: mem9Results.length,
        },
      });
    }

    case "memory_get": {
      const path = input.path as string;
      const from = input.from as number | undefined;
      const lines = input.lines as number | undefined;
      console.log(`[memory] get: ${path} from=${from ?? 1} lines=${lines ?? 50}`);

      return getMemoryLines(path, from, lines);
    }

    case "memory_store": {
      const content = input.content as string;
      const userId = input.user_id as string | undefined;

      if (!mem9Enabled()) {
        return JSON.stringify({
          error: "mem9 not configured. Set MEM9_API_KEY and MEM9_ORG_ID environment variables.",
        });
      }

      try {
        const result = await mem9Store({
          content,
          userId,
          metadata: { source: "discordclaw" },
        });
        console.log(`[memory] Stored to mem9: ${content.slice(0, 80)}...`);
        return JSON.stringify({
          success: true,
          id: result.id,
          message: "Memory stored in mem9 cloud.",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[memory] mem9 store failed:", msg);
        return JSON.stringify({ error: `Failed to store memory: ${msg}` });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown memory tool: ${name}` });
  }
}
