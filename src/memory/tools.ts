import { searchMemory, getMemoryLines } from "./memory.js";
import { searchMem9, storeMem9, updateMem9, deleteMem9, isMem9Enabled } from "./mem9.js";

// ---------------------------------------------------------------------------
// Tool definitions (passed to the Claude agent as available tools)
// ---------------------------------------------------------------------------

const baseMemoryTools = [
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
];

/** mem9 cloud memory tools — only included when mem9 is configured */
const mem9Tools = [
  {
    name: "mem9_store",
    description:
      "Store a memory in mem9 cloud. Use for important facts, preferences, decisions, and context that should persist across sessions. mem9 auto-decomposes long content into atomic memories with tags.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The fact or information to remember",
        },
        metadata: {
          type: "object",
          description:
            'Optional metadata (e.g. {"source": "conversation", "topic": "project-x"})',
        },
      },
      required: ["content"],
    },
  },
  {
    name: "mem9_update",
    description:
      "Update an existing mem9 cloud memory by ID. Use when a fact has changed and the old memory should be replaced.",
    input_schema: {
      type: "object" as const,
      properties: {
        memory_id: { type: "string", description: "ID of the memory to update" },
        content: { type: "string", description: "New content for the memory" },
      },
      required: ["memory_id", "content"],
    },
  },
  {
    name: "mem9_delete",
    description:
      "Delete a mem9 cloud memory by ID. Use when a memory is no longer relevant or accurate.",
    input_schema: {
      type: "object" as const,
      properties: {
        memory_id: { type: "string", description: "ID of the memory to delete" },
      },
      required: ["memory_id"],
    },
  },
];

/** Build the full tool list — includes mem9 tools only when configured */
export function getMemoryTools() {
  if (isMem9Enabled()) {
    return [...baseMemoryTools, ...mem9Tools];
  }
  return [...baseMemoryTools];
}

/** Static export for backward compat (tool registration at import time) */
export const memoryTools = baseMemoryTools;

// ---------------------------------------------------------------------------
// Tool call handler (async — queries both local FTS5 and mem9 cloud)
// ---------------------------------------------------------------------------

export async function handleMemoryTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "memory_search": {
      const query = input.query as string;
      const maxResults = (input.max_results as number | undefined) ?? 5;
      console.log(`[memory] search: "${query}" (max ${maxResults})`);

      // Run local and cloud searches in parallel
      const [localResults, cloudResults] = await Promise.all([
        Promise.resolve(searchMemory(query, maxResults)),
        searchMem9(query, maxResults),
      ]);

      // Format local results
      const local = localResults.map((r) => ({
        source: "local" as const,
        path: r.path,
        chunkText: r.chunkText,
        startLine: r.startLine,
        endLine: r.endLine,
        score: r.score,
      }));

      // Format cloud results
      const cloud = cloudResults.map((r) => ({
        source: "mem9" as const,
        id: r.id,
        content: r.content,
        memory_type: r.memory_type,
        tags: r.tags,
      }));

      const hasLocal = local.length > 0;
      const hasCloud = cloud.length > 0;

      if (!hasLocal && !hasCloud) {
        return JSON.stringify({ results: [], message: "No matches found." });
      }

      const response: Record<string, unknown> = {};
      if (hasLocal) response.local = local;
      if (hasCloud) response.mem9 = cloud;

      return JSON.stringify(response);
    }

    case "memory_get": {
      const path = input.path as string;
      const from = input.from as number | undefined;
      const lines = input.lines as number | undefined;
      console.log(`[memory] get: ${path} from=${from ?? 1} lines=${lines ?? 50}`);

      return getMemoryLines(path, from, lines);
    }

    case "mem9_store": {
      const content = input.content as string;
      const metadata = input.metadata as Record<string, unknown> | undefined;
      console.log(`[mem9] store: "${content.slice(0, 80)}..."`);

      const ok = await storeMem9(content, metadata);
      return JSON.stringify({
        success: ok,
        message: ok
          ? "Memory stored in mem9 cloud (processing async)."
          : "Failed to store memory in mem9.",
      });
    }

    case "mem9_update": {
      const memoryId = input.memory_id as string;
      const content = input.content as string;
      console.log(`[mem9] update: ${memoryId}`);

      const ok = await updateMem9(memoryId, content);
      return JSON.stringify({
        success: ok,
        message: ok
          ? `Memory ${memoryId} updated.`
          : `Failed to update memory ${memoryId}.`,
      });
    }

    case "mem9_delete": {
      const memoryId = input.memory_id as string;
      console.log(`[mem9] delete: ${memoryId}`);

      const ok = await deleteMem9(memoryId);
      return JSON.stringify({
        success: ok,
        message: ok
          ? `Memory ${memoryId} deleted.`
          : `Failed to delete memory ${memoryId}.`,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown memory tool: ${name}` });
  }
}
