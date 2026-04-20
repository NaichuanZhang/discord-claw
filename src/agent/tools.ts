// ---------------------------------------------------------------------------
// Discord tool definitions for the Anthropic Messages API
// ---------------------------------------------------------------------------

import { existsSync, statSync } from "fs";
import { basename } from "path";
import { registerBotThread } from "../bot/messages.js";
import {
  isGuildTextChannel,
  ensureThread,
  generateThreadName,
  MAX_THREAD_NAME_LENGTH,
} from "../shared/discord-utils.js";
import {
  registerArtifactFromFile,
  getArtifactDownloadUrl,
  updateArtifactDiscordInfo,
  formatFileSize,
} from "../artifacts/index.js";

export const discordTools = [
  {
    name: "send_message",
    description: "Send a message to a Discord channel",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: { type: "string", description: "Discord channel ID" },
        text: { type: "string", description: "Message text to send" },
      },
      required: ["channel_id", "text"],
    },
  },
  {
    name: "send_file",
    description:
      "Send a file (attachment) to a Discord channel. Optionally include a text message alongside the file. Use this to share PDFs, images, HTML files, or any other file from disk.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: { type: "string", description: "Discord channel ID" },
        file_path: {
          type: "string",
          description:
            "Absolute path to the file on disk to send as an attachment",
        },
        message: {
          type: "string",
          description:
            "Optional text message to include with the file attachment",
        },
        filename: {
          type: "string",
          description:
            "Optional custom filename for the attachment (defaults to the original filename)",
        },
      },
      required: ["channel_id", "file_path"],
    },
  },
  {
    name: "add_reaction",
    description: "React to a message with an emoji",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: { type: "string", description: "Channel ID" },
        message_id: {
          type: "string",
          description: "Message ID to react to",
        },
        emoji: {
          type: "string",
          description: "Emoji to react with (unicode or custom :name:id)",
        },
      },
      required: ["channel_id", "message_id", "emoji"],
    },
  },
  {
    name: "get_channel_history",
    description: "Get recent messages from a Discord channel",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: { type: "string", description: "Channel ID" },
        limit: {
          type: "number",
          description: "Number of messages (default 20, max 100)",
        },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "create_thread",
    description:
      "Create a new thread in a Discord channel. Returns the thread's channel ID which you can then use with send_message to post inside it.",
    input_schema: {
      type: "object" as const,
      properties: {
        channel_id: {
          type: "string",
          description: "Parent channel ID to create the thread in",
        },
        name: {
          type: "string",
          description:
            "Thread name (max 100 characters, e.g. '4/10' for a date-based thread)",
        },
        message: {
          type: "string",
          description:
            "Optional initial message to send in the thread. If omitted, creates an empty thread.",
        },
      },
      required: ["channel_id", "name"],
    },
  },
];

// ---------------------------------------------------------------------------
// Discord client reference
// ---------------------------------------------------------------------------

// Using `any` for the Discord client and channel types intentionally — this
// module is a thin bridge and fully typing discord.js internals here adds
// complexity with no safety benefit.

let discordClient: any = null;

export function setDiscordClient(client: any): void {
  discordClient = client;
}

// ---------------------------------------------------------------------------
// Session context for artifact tracking
// ---------------------------------------------------------------------------

/** Current session ID, set by the message handler before tool dispatch. */
let currentSessionId: string | null = null;

export function setToolSessionContext(sessionId: string | null): void {
  currentSessionId = sessionId;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Discord's max file upload size for bots (default tier: 25 MB). */
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function handleDiscordTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  if (!discordClient) {
    return JSON.stringify({ error: "Discord client not available" });
  }

  try {
    switch (name) {
      case "send_message": {
        const channelId = input.channel_id as string;
        const text = input.text as string;
        console.log(`[agent] send_message -> channel ${channelId}`);
        const channel: any = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.send) {
          return JSON.stringify({
            error: `Channel ${channelId} not found or not a text channel`,
          });
        }

        // If targeting a guild text channel, auto-create a thread
        let sendTarget = channel;
        let threadId: string | undefined;
        if (isGuildTextChannel(channel)) {
          const threadName = generateThreadName(text);
          sendTarget = await ensureThread(channel, threadName, "agent");
          threadId = sendTarget.id;
        }

        const sent = await sendTarget.send(text);
        return JSON.stringify({
          success: true,
          message_id: sent.id,
          channel_id: threadId ?? channelId,
          ...(threadId ? { thread_id: threadId, parent_channel_id: channelId } : {}),
        });
      }

      case "send_file": {
        const channelId = input.channel_id as string;
        const filePath = input.file_path as string;
        const message = (input.message as string) || undefined;
        const customFilename = (input.filename as string) || undefined;

        console.log(
          `[agent] send_file -> channel ${channelId}, file ${filePath}`,
        );

        // Validate the file exists
        if (!existsSync(filePath)) {
          return JSON.stringify({
            error: `File not found: ${filePath}`,
          });
        }

        // Check file size
        const stats = statSync(filePath);
        const filename = customFilename || basename(filePath);

        // Register as output artifact (regardless of whether we can send via Discord)
        let artifactId: string | undefined;
        if (currentSessionId) {
          try {
            const artifact = registerArtifactFromFile(
              {
                sessionId: currentSessionId,
                direction: "output",
                filename,
                sizeBytes: stats.size,
              },
              filePath,
            );
            artifactId = artifact.id;
          } catch (err) {
            console.error("[agent] Failed to register output artifact:", err);
          }
        }

        // If file is too large for Discord, provide gateway download link instead
        if (stats.size > MAX_FILE_SIZE_BYTES) {
          if (artifactId && currentSessionId) {
            const downloadUrl = getArtifactDownloadUrl(currentSessionId, artifactId);
            return JSON.stringify({
              success: true,
              too_large_for_discord: true,
              download_url: downloadUrl,
              filename,
              size: formatFileSize(stats.size),
              size_bytes: stats.size,
              artifact_id: artifactId,
              note: `File is ${formatFileSize(stats.size)} which exceeds Discord's 25 MB limit. Share the download_url with the user instead.`,
            });
          }
          return JSON.stringify({
            error: `File too large (${formatFileSize(stats.size)}). Discord limit is 25 MB. No gateway URL available (no session context).`,
          });
        }

        const channel: any = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.send) {
          return JSON.stringify({
            error: `Channel ${channelId} not found or not a text channel`,
          });
        }

        // Send directly to the specified channel — no auto-thread-creation.
        // The agent should be sending to the conversation thread channel_id.
        const sendTarget = channel;

        const attachment: { attachment: string; name?: string } = {
          attachment: filePath,
        };
        if (customFilename) {
          attachment.name = customFilename;
        }

        const sendPayload: { files: typeof attachment[]; content?: string } = {
          files: [attachment],
        };
        if (message) {
          sendPayload.content = message;
        }

        const sent = await sendTarget.send(sendPayload);
        const sentAttachment = sent.attachments?.first();

        // Update artifact with Discord info
        if (artifactId && sentAttachment?.url) {
          try {
            updateArtifactDiscordInfo(artifactId, sentAttachment.url, sent.id);
          } catch (err) {
            console.error("[agent] Failed to update artifact Discord info:", err);
          }
        }

        return JSON.stringify({
          success: true,
          message_id: sent.id,
          channel_id: channelId,
          filename: sentAttachment?.name ?? filename,
          size: formatFileSize(stats.size),
          size_bytes: stats.size,
          ...(artifactId ? { artifact_id: artifactId } : {}),
        });
      }

      case "add_reaction": {
        const channelId = input.channel_id as string;
        const messageId = input.message_id as string;
        const emoji = input.emoji as string;
        console.log(
          `[agent] add_reaction -> channel ${channelId}, message ${messageId}, emoji ${emoji}`,
        );
        const channel: any = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.messages) {
          return JSON.stringify({
            error: `Channel ${channelId} not found or not a text channel`,
          });
        }
        const message = await channel.messages.fetch(messageId);
        await message.react(emoji);
        return JSON.stringify({
          success: true,
          channel_id: channelId,
          message_id: messageId,
          emoji,
        });
      }

      case "get_channel_history": {
        const channelId = input.channel_id as string;
        const limit = Math.min((input.limit as number) || 20, 100);
        console.log(
          `[agent] get_channel_history -> channel ${channelId}, limit ${limit}`,
        );
        const channel: any = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.messages) {
          return JSON.stringify({
            error: `Channel ${channelId} not found or not a text channel`,
          });
        }
        const messages = await channel.messages.fetch({ limit });
        const formatted = Array.from(messages.values()).map((msg: any) => ({
          id: msg.id,
          author: msg.author?.tag ?? "unknown",
          content: msg.content,
          timestamp: msg.createdTimestamp,
        }));
        return JSON.stringify({ messages: formatted });
      }

      case "create_thread": {
        const channelId = input.channel_id as string;
        const threadName = (input.name as string).slice(
          0,
          MAX_THREAD_NAME_LENGTH,
        );
        const initialMessage = (input.message as string) || undefined;

        console.log(
          `[agent] create_thread -> channel ${channelId}, name "${threadName}"`,
        );

        const channel: any = await discordClient.channels.fetch(channelId);
        if (!channel || !channel.threads) {
          return JSON.stringify({
            error: `Channel ${channelId} not found or doesn't support threads`,
          });
        }

        const thread = await channel.threads.create({
          name: threadName,
          // ChannelType.PublicThread = 11
          type: 11,
        });

        // Register as bot-created thread
        registerBotThread(thread.id);

        // Send initial message if provided
        if (initialMessage) {
          await thread.send(initialMessage);
        }

        return JSON.stringify({
          success: true,
          thread_id: thread.id,
          thread_name: thread.name,
          parent_channel_id: channelId,
        });
      }

      default:
        return JSON.stringify({ error: `Unknown discord tool: ${name}` });
    }
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    console.error(`[agent] Discord tool "${name}" failed:`, errorMessage);
    return JSON.stringify({ error: errorMessage });
  }
}
